import { and, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import {
  agentWakeupRequests, approvals, assets, decisionBundles, decisionEffectExecutions, decisions,
  executionWorkspaces, executionWorkspaceRestorePoints, heartbeatRuns, issueApprovals,
  issueAttachments, issueComments, issueDocuments, issues, routines, type Db,
} from "@paperclipai/db";
import type { IssueDeletionImpact, IssueTaskArchiveFilter } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { logActivity, publishActivity, type ActivityPublication, type LogActivityInput } from "./activity-log.js";

type IssueRow = typeof issues.$inferSelect;

export function taskArchiveCondition(mode: IssueTaskArchiveFilter = "active") {
  if (mode === "all") return sql<boolean>`true`;
  return mode === "archived"
    ? sql<boolean>`${issues.taskArchivedAt} is not null`
    : sql<boolean>`${issues.taskArchivedAt} is null`;
}

export function isTerminalTask(issue: Pick<IssueRow, "status">) {
  return issue.status === "done" || issue.status === "cancelled";
}

export function assertDeletionOwner(issue: IssueRow, userId: string) {
  if (issue.conversationAgentId && issue.conversationUserId !== userId) {
    throw notFound("Issue not found");
  }
}

export async function setTaskArchived(
  db: Db, companyId: string, id: string, archived: boolean,
  actor: Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId" | "agentApiKeyId">,
) {
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async (tx) => {
    const where = and(eq(issues.companyId, companyId), eq(issues.id, id));
    const [issue] = await tx.select().from(issues).where(where).for("update");
    if (!issue || issue.conversationAgentId || issue.hiddenAt) throw notFound("Issue not found");
    if (!!issue.taskArchivedAt === archived) return { id, taskArchivedAt: issue.taskArchivedAt };
    if (archived && !isTerminalTask(issue)) {
      throw conflict("Complete or cancel the task before archiving it.", { code: "task_archive_not_terminal" });
    }
    if (archived) {
      const [activeChild] = await tx.select({ id: issues.id }).from(issues).where(and(
        eq(issues.companyId, companyId), eq(issues.parentId, id), notInArray(issues.status, ["done", "cancelled"]),
      )).limit(1);
      if (activeChild || await issueHasActiveWork(tx as unknown as Db, issue)) {
        throw conflict("Wait for the task and its subtasks to finish before archiving.", { code: "task_archive_active_work" });
      }
    }
    const taskArchivedAt = archived ? new Date() : null;
    // Keep updatedAt unchanged: inbox ordering and task wake decisions use
    // it as an indication that someone changed or commented on the task.
    await tx.update(issues).set({ taskArchivedAt }).where(where);
    await logActivity(tx as unknown as Db, {
      ...actor, companyId, entityType: "issue", entityId: id,
      action: archived ? "issue.archived" : "issue.restored",
    }, publications);
    return { id, taskArchivedAt };
  });
  for (const publication of publications) publishActivity(publication);
  return result;
}

export async function issueHasActiveWork(db: Db, issue: IssueRow) {
  const { id, companyId } = issue;
  const runIds = [issue.executionRunId, issue.checkoutRunId].filter((runId): runId is string => !!runId);
  const [run] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId),
    inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
    or(
      eq(heartbeatRuns.issueId, id),
      eq(heartbeatRuns.nativeIssueId, id),
      runIds.length ? inArray(heartbeatRuns.id, runIds) : undefined,
      sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${id}
        or ${heartbeatRuns.contextSnapshot}->>'taskId' = ${id}`,
    ),
  )).limit(1);
  if (run) return true;
  const [request] = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, companyId),
    inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
    sql`(${agentWakeupRequests.payload}->>'issueId' = ${id}
      or ${agentWakeupRequests.payload}->>'taskId' = ${id}
      or ${agentWakeupRequests.payload}->'_paperclipWakeContext'->>'issueId' = ${id}
      or ${agentWakeupRequests.payload}->'_paperclipWakeContext'->>'taskId' = ${id})`,
  )).limit(1);
  return !!request;
}

export async function readIssueDeletionImpact(db: Db, issue: IssueRow): Promise<IssueDeletionImpact> {
  const { id, companyId } = issue;
  const [result] = await db.select({
    comments: sql<number>`(select count(*)::integer from ${issueComments} where ${issueComments.issueId} = ${id})`,
    documents: sql<number>`(select count(*)::integer from ${issueDocuments} where ${issueDocuments.issueId} = ${id})`,
    attachments: sql<number>`(select count(*)::integer from ${issueAttachments} where ${issueAttachments.issueId} = ${id})`,
    attachmentBytes: sql<number>`(select coalesce(sum(asset.byte_size), 0) from ${issueAttachments} attachment
      join ${assets} asset on asset.id = attachment.asset_id where attachment.issue_id = ${id})`.mapWith(Number),
    children: sql<boolean>`exists (select 1 from ${issues} child where child.id <> ${id}
      and (child.parent_id = ${id} or child.privacy_root_issue_id = ${id}))`,
    approval: sql<boolean>`exists (select 1 from ${issueApprovals} link
      join ${approvals} approval on approval.id = link.approval_id
      where link.issue_id = ${id} and approval.status in ('pending', 'revision_requested'))`,
    schedule: sql<boolean>`exists (select 1 from ${routines} where ${routines.companyId} = ${companyId} and ${routines.parentIssueId} = ${id})`,
    workspace: sql<boolean>`exists (select 1 from ${executionWorkspaces}
      where ${executionWorkspaces.companyId} = ${companyId} and ${executionWorkspaces.sourceIssueId} = ${id})
      or exists (select 1 from ${executionWorkspaceRestorePoints} where ${and(
        eq(executionWorkspaceRestorePoints.companyId, companyId),
        eq(executionWorkspaceRestorePoints.sourceIssueId, id),
        ne(executionWorkspaceRestorePoints.status, "deleted"),
      )})`,
    decision: sql<boolean>`exists (select 1 from ${decisions} where ${decisions.originIssueId} = ${id})
      or exists (select 1 from ${decisionBundles} where ${decisionBundles.originIssueId} = ${id})
      or exists (select 1 from ${decisionEffectExecutions} where ${decisionEffectExecutions.targetIssueId} = ${id})`,
  }).from(issues).where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
  if (!result) throw notFound("Issue not found");
  const blockers: IssueDeletionImpact["blockers"] = [];
  const archived = issue.conversationAgentId ? !!issue.hiddenAt : !!issue.taskArchivedAt && isTerminalTask(issue);
  if (!archived) blockers.push("archive_required");
  if (await issueHasActiveWork(db, issue)) blockers.push("active_work");
  if (result.children) blockers.push("children");
  if (result.approval) blockers.push("approval");
  if (result.schedule || issue.monitorNextCheckAt || issue.monitorWakeRequestedAt) blockers.push("schedule");
  if (result.workspace || issue.executionWorkspaceId) blockers.push("workspace");
  if (result.decision) blockers.push("decision");
  return { blockers, comments: result.comments, documents: result.documents, attachments: result.attachments, attachmentBytes: result.attachmentBytes };
}

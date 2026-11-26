import { notifyStatusCardIssueChange } from "./status-card-notifications.js";
import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { notifyExternalConversationSettlement } from "./external-conversation-settlement-notifications.js";
import { notifyUnsafeWorkspaceExportRecovery } from "./unsafe-workspace-export-notifications.js";
import { notifyCancelledWorkspacePreservation } from "./cancelled-workspace-preservation-notifications.js";
import { notifyInstructionCollection } from "./instruction-collection-notifications.js";
import { notifyDirectoryCleanup } from "./directory-cleanup-notifications.js";
import { notifyInstructionCommit } from "./instruction-commit-notifications.js";
import { notifyScheduledRetryCancellation } from "./scheduled-retry-cancellation-notifications.js";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import type { AgentDeleteImpact } from "@paperclipai/shared";
import { agents, agentApiKeys, agentRuntimeState, agentTaskSessions, agentWakeupRequests, activityLog,
  budgetReservations, costEvents, financeEvents, heartbeatRunEvents, heartbeatRuns, issueExecutionDecisions, issues, issueComments,
  approvalComments, approvals, caseHandoffs, joinRequests, principalPermissionGrants, routines, type Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { readBuiltInAgentMarker } from "../lib/built-in-agent-metadata.js";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";
import { deleteAgentAdmissionHistory } from "../modules/execution-admission/index.js";

function agentRunIds(companyId: string, id: string) {
  return sql`select ${heartbeatRuns.id} from ${heartbeatRuns} where ${heartbeatRuns.companyId} = ${companyId} and ${heartbeatRuns.agentId} = ${id}`;
}

async function retainedHistoryConflict(tx: Db, companyId: string, id: string) {
  const [retainedHandoff] = await tx.select({ id: caseHandoffs.id }).from(caseHandoffs).where(and(
    eq(caseHandoffs.companyId, companyId), or(eq(caseHandoffs.fromAgentId, id), eq(caseHandoffs.toAgentId, id)),
  )).limit(1);
  if (retainedHandoff) return conflict("Saved case handoff history requires this agent record. Keep the agent terminated instead of permanently deleting it", {
    code: "agent_case_history_retained",
  });
  const [decisionHold] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
    eq(budgetReservations.companyId, companyId), eq(budgetReservations.agentId, id),
    eq(budgetReservations.state, "held"), sql`${budgetReservations.decisionInvocationId} is not null`,
  )).limit(1);
  if (decisionHold) return conflict("Wait for active decisions or resolve their unknown charges in Costs before deleting this agent", {
    code: "agent_decision_accounting_pending",
  });
  const [classifierHold] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
    eq(budgetReservations.companyId, companyId), eq(budgetReservations.agentId, id),
    eq(budgetReservations.state, "held"), sql`${budgetReservations.promptInjectionInvocationId} is not null`,
  )).limit(1);
  if (classifierHold) return conflict("Wait for active prompt injection checks or resolve their unknown charges in Costs before deleting this agent", {
    code: "agent_prompt_injection_accounting_pending",
  });
  const [fastResponseHold] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
    eq(budgetReservations.companyId, companyId), eq(budgetReservations.agentId, id),
    eq(budgetReservations.state, "held"), sql`${budgetReservations.fastResponseRequestId} is not null`,
  )).limit(1);
  if (fastResponseHold) return conflict("Wait for active fast responses or resolve their unknown charges in Costs before deleting this agent", {
    code: "agent_fast_response_accounting_pending",
  });
  const agentRuns = agentRunIds(companyId, id);
  const [retainedCost] = await tx.select({ id: costEvents.id }).from(costEvents).where(and(
    eq(costEvents.companyId, companyId), or(eq(costEvents.agentId, id), sql`${costEvents.heartbeatRunId} in (${agentRuns})`),
  )).limit(1);
  const [retainedFinance] = await tx.select({ id: financeEvents.id }).from(financeEvents).where(and(
    eq(financeEvents.companyId, companyId), or(eq(financeEvents.agentId, id), sql`${financeEvents.heartbeatRunId} in (${agentRuns})`),
  )).limit(1);
  if (retainedCost || retainedFinance) return conflict("Cost history requires this agent record. Keep the agent terminated instead of permanently deleting it", {
    code: "agent_cost_history_retained",
  });
  const [conversation] = await tx.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.conversationAgentId, id),
  )).limit(1);
  if (conversation) return conflict("Saved conversations require this agent record. Review its conversations before permanently deleting the agent", {
    code: "agent_conversations_retained",
  });
  const [routine] = await tx.select({ id: routines.id }).from(routines).where(and(
    eq(routines.companyId, companyId), eq(routines.assigneeAgentId, id),
  )).limit(1);
  if (routine) return conflict("Reassign the agent's routines before permanently deleting it", {
    code: "agent_routines_retained",
  });
  const [retainedLog] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, id), isNotNull(heartbeatRuns.logRef),
  )).limit(1);
  if (retainedLog) return conflict("Clean up the agent's saved execution logs before permanently deleting it", {
    code: "agent_run_logs_retained",
  });
  const [runEvent] = await tx.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.agentId, id),
  )).limit(1);
  if (runEvent) return conflict("Structured execution history requires this agent record. Keep the agent terminated to preserve it", {
    code: "agent_run_audit_retained",
  });
  return null;
}

export async function previewAgentDeletion(
  db: Db,
  agent: { id: string; companyId: string; lifecycleState: string; metadata: unknown },
): Promise<AgentDeleteImpact> {
  const { companyId, id } = agent;
  const agentRuns = agentRunIds(companyId, id);
  const blocker = readBuiltInAgentMarker(agent.metadata)
    ? conflict("Built-in agents cannot be deleted", { code: "built_in_agent_undeletable" })
    : !["terminated", "rejected"].includes(agent.lifecycleState)
      ? conflict("Complete termination before deleting the agent", { code: "agent_termination_pending" })
      : await retainedHistoryConflict(db, companyId, id);
  const [tasks, reports, runs, sessions, approvalCount, auditEvents] = await Promise.all([
    db.$count(issues, and(eq(issues.companyId, companyId), or(eq(issues.assigneeAgentId, id), eq(issues.createdByAgentId, id)))),
    db.$count(agents, and(eq(agents.companyId, companyId), eq(agents.reportsTo, id))),
    db.$count(heartbeatRuns, and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, id))),
    db.$count(agentTaskSessions, and(eq(agentTaskSessions.companyId, companyId), eq(agentTaskSessions.agentId, id))),
    db.$count(approvals, and(eq(approvals.companyId, companyId), eq(approvals.requestedByAgentId, id))),
    db.$count(activityLog, and(eq(activityLog.companyId, companyId), or(eq(activityLog.agentId, id), sql`${activityLog.runId} in (${agentRuns})`))),
  ]);
  return {
    allowed: blocker === null,
    blockedCode: (blocker?.details as { code?: string } | undefined)?.code ?? null,
    blockedReason: blocker?.message ?? null,
    counts: { tasks, reports, runs, sessions, approvals: approvalCount, auditEvents },
  };
}

export async function deleteAgentDependencies(tx: Db, companyId: string, id: string) {
  // Fence admissions before inspecting holds in the caller's READ COMMITTED transaction.
  await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, id))).for("update");
  const blocker = await retainedHistoryConflict(tx, companyId, id);
  if (blocker) throw blocker;
  const agentRuns = agentRunIds(companyId, id);
  await notifyAttentionRetentionWork(tx, { companyId });
  await notifyExternalConversationSettlement(tx, { companyId });
  await issueThreadInteractionService(tx).cancelPendingForDeletedAddressee(companyId, id);
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
  await notifyStatusCardIssueChange(tx, companyId);
  await tx.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, id));
  await tx
    .update(issues)
    .set({ assigneeAgentId: null, createdByAgentId: null })
    .where(or(eq(issues.assigneeAgentId, id), eq(issues.createdByAgentId, id)));
  await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.agentId, id));
  await tx.update(activityLog).set({ agentId: null }).where(and(eq(activityLog.companyId, companyId), eq(activityLog.agentId, id)));
  await tx.update(activityLog).set({ runId: null }).where(and(eq(activityLog.companyId, companyId), sql`${activityLog.runId} in (${agentRuns})`));
  await tx.update(approvals).set({ requestedByAgentId: null }).where(and(eq(approvals.companyId, companyId), eq(approvals.requestedByAgentId, id)));
  await tx.update(approvalComments).set({ authorAgentId: null }).where(and(eq(approvalComments.companyId, companyId), eq(approvalComments.authorAgentId, id)));
  await tx.update(joinRequests).set({ createdAgentId: null }).where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.createdAgentId, id)));
  await tx.update(issueExecutionDecisions).set({ actorAgentId: null }).where(and(eq(issueExecutionDecisions.companyId, companyId), eq(issueExecutionDecisions.actorAgentId, id)));
  await tx.update(issueComments).set({ authorAgentId: null }).where(and(eq(issueComments.companyId, companyId), eq(issueComments.authorAgentId, id)));
  await notifyScheduledRetryCancellation(tx, { companyId: companyId });
  await notifyInstructionCommit(tx, { companyId: companyId });
  await notifyDirectoryCleanup(tx, { companyId: companyId });
  await notifyInstructionCollection(tx, { companyId: companyId });
  await notifyCancelledWorkspacePreservation(tx, { companyId: companyId });
  await notifyUnsafeWorkspaceExportRecovery(tx, { companyId });
  if ((await deleteAgentAdmissionHistory(tx, { companyId, agentId: id })).kind === "unsettled") {
    throw conflict("Wait for this agent's admitted task executions to settle before deleting it", {
      code: "agent_execution_admission_pending",
    });
  }
  await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.agentId, id));
  await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, id));
  await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
  await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.agentId, id));
  await tx.delete(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.companyId, companyId),
    eq(principalPermissionGrants.principalType, "agent"),
    eq(principalPermissionGrants.principalId, id),
  ));
}

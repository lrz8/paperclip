import { heartbeatRuns, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { conflict, notFound } from "../../errors.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { getRunLogStore, type RunLogStore } from "../run-log-store.js";

const completedStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export async function changeRunLifecycle(
  db: Db,
  input: { companyId: string; runId: string; userId: string; action: "archive" | "restore" | "purge-log" },
  logStore: () => RunLogStore = getRunLogStore,
) {
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async (tx) => {
    const scope = and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId));
    const [run] = await tx.select({
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      finishedAt: heartbeatRuns.finishedAt,
      archivedAt: heartbeatRuns.archivedAt,
      logPurgedAt: heartbeatRuns.logPurgedAt,
      logStore: heartbeatRuns.logStore,
      logRef: heartbeatRuns.logRef,
      logBytes: heartbeatRuns.logBytes,
    }).from(heartbeatRuns).where(scope).for("update");
    if (!run) throw notFound("Heartbeat run not found");
    const { archivedAt, logPurgedAt } = run;
    if ((input.action === "archive" && archivedAt) || (input.action === "restore" && !archivedAt)
      || (input.action === "purge-log" && logPurgedAt)) return { archivedAt, logPurgedAt };

    const now = new Date();
    if (input.action !== "restore" && (!run.finishedAt || !completedStatuses.has(run.status))) {
      throw conflict("Only completed runs can be archived or cleaned up");
    }
    if (input.action === "purge-log") {
      // Local finalized logs have no source backfill or remote journal writer to race.
      const expectedRef = `${input.companyId}/${run.agentId}/${input.runId}.ndjson`;
      if (!archivedAt || run.logStore !== "local_file" || run.logRef !== expectedRef || run.logBytes === null) {
        throw conflict("Only finalized local logs of archived runs can be removed");
      }
      const store = logStore();
      if (!store.remove) throw conflict("Run log storage does not support removal");
      await store.remove({ store: "local_file", logRef: run.logRef }, AbortSignal.timeout(15_000));
    }

    const [updated] = await tx.update(heartbeatRuns).set(input.action === "purge-log" ? {
      logPurgedAt: now, logStore: null, logRef: null, logBytes: null, logSha256: null,
      logCompressed: false, stdoutExcerpt: null, stderrExcerpt: null,
    } : { archivedAt: input.action === "archive" ? now : null }).where(scope).returning({
      archivedAt: heartbeatRuns.archivedAt,
      logPurgedAt: heartbeatRuns.logPurgedAt,
    });
    await logActivity(tx as unknown as Db, {
      companyId: input.companyId, actorType: "user", actorId: input.userId,
      action: `heartbeat.${{ archive: "archived", restore: "restored", "purge-log": "log_purged" }[input.action]}`,
      entityType: "heartbeat_run", entityId: input.runId,
      details: input.action === "purge-log" ? { logBytes: run.logBytes } : undefined,
    }, publications);
    return updated!;
  });
  for (const publication of publications) publishActivity(publication);
  return result;
}

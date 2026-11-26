import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, agents, assets, costEvents, heartbeatRuns, issueAttachments, issueComments, issues } from "@paperclipai/db";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";
import { describeEmbeddedPostgres, seedCompanyWithBoardAccess, useEmbeddedPostgres, type BoardActor } from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("task lifecycle", () => {
  const ctx = useEmbeddedPostgres("paperclip-task-lifecycle-");
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "paperclip-task-attachments-")); });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  function app(actor: BoardActor, storage = createStorageService(createLocalDiskStorageProvider(root))) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor as Express.Request["actor"]; next(); });
    app.use("/api", issueRoutes(ctx.db, storage));
    app.use(errorHandler);
    return request(app);
  }

  it("archives and restores completed tasks across list and title search while keeping costs and run history on deletion", async () => {
    const f = await seedCompanyWithBoardAccess(ctx.db, "Task lifecycle");
    const storage = createStorageService(createLocalDiskStorageProvider(root));
    const api = app(f.actor, storage);
    const [task] = await ctx.db.insert(issues).values({
      companyId: f.companyId, title: "Golden archive task", status: "done", createdByUserId: f.userId,
    }).returning();
    const id = task!.id;
    const url = `/api/issues/${id}`;
    const list = `/api/companies/${f.companyId}/issues`;
    const [agent] = await ctx.db.insert(agents).values({ companyId: f.companyId, name: "Test worker" }).returning();
    const [run] = await ctx.db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: agent!.id, issueId: id, invocationSource: "manual", status: "succeeded",
    }).returning();
    const [cost] = await ctx.db.insert(costEvents).values({
      companyId: f.companyId, agentId: agent!.id, issueId: id, heartbeatRunId: run!.id,
      provider: "test", model: "test", costCents: 42, occurredAt: new Date(),
    }).returning();
    await ctx.db.insert(issueComments).values({ companyId: f.companyId, issueId: id, authorUserId: f.userId, body: "fixture" });
    const file = await storage.putFile({ companyId: f.companyId, namespace: "task-test", contentType: "text/plain", originalFilename: "proof.txt", body: Buffer.from("proof") });
    const [asset] = await ctx.db.insert(assets).values({
      companyId: f.companyId, provider: file.provider, objectKey: file.objectKey, contentType: file.contentType,
      byteSize: file.byteSize, sha256: file.sha256, originalFilename: file.originalFilename,
    }).returning();
    await ctx.db.insert(issueAttachments).values({ companyId: f.companyId, issueId: id, assetId: asset!.id });

    expect((await api.get(`${url}/deletion-impact`).expect(200)).body).toMatchObject({ blockers: ["archive_required"], comments: 1, attachments: 1, attachmentBytes: 5 });
    await api.delete(url).query({ confirm: id }).expect(409);
    const archived = await api.post(`${url}/task-archive`).expect(200);
    expect(archived.body.taskArchivedAt).toEqual(expect.any(String));
    expect((await api.post(`${url}/task-archive`).expect(200)).body).toEqual(archived.body);
    expect((await api.get(list).query({ view: "index", taskArchive: "active", q: "Golden" }).expect(200)).body).toEqual([]);
    expect((await api.get(list).query({ view: "index", taskArchive: "archived", q: "Golden" }).expect(200)).body)
      .toEqual([expect.objectContaining({ id, taskArchivedAt: archived.body.taskArchivedAt })]);
    const foreign = await seedCompanyWithBoardAccess(ctx.db, "Other task organization");
    await app(foreign.actor).get(`${url}/deletion-impact`).expect(404);
    await api.patch(url).send({ status: "todo" }).expect(409);
    await api.delete(`${url}/task-archive`).expect(200, { id, taskArchivedAt: null });
    expect((await api.get(list).query({ view: "index", taskArchive: "active", q: "Golden" }).expect(200)).body).toHaveLength(1);
    await api.post(`${url}/task-archive`).expect(200);
    expect((await api.get(`${url}/deletion-impact`).expect(200)).body.blockers).toEqual([]);
    await api.delete(url).expect(400);
    await api.delete(url).query({ confirm: id }).expect(200);
    await api.get(url).expect(404);
    expect(await ctx.db.select().from(issueComments).where(eq(issueComments.issueId, id))).toHaveLength(0);
    expect(await ctx.db.select().from(assets).where(eq(assets.id, asset!.id))).toHaveLength(0);
    expect(await storage.headObject(f.companyId, file.objectKey)).toEqual({ exists: false });
    expect((await ctx.db.select().from(costEvents).where(eq(costEvents.id, cost!.id)))[0])
      .toMatchObject({ costCents: 42, issueId: null, heartbeatRunId: run!.id });
    expect((await ctx.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]).toMatchObject({ status: "succeeded", issueId: null });
    expect((await ctx.db.select().from(activityLog).where(eq(activityLog.entityId, id))).map(row => row.action))
      .toEqual(expect.arrayContaining(["issue.archived", "issue.restored", "issue.deleted"]));
  });

  it("rejects archiving incomplete and executing tasks and blocks deletion while subtasks remain", async () => {
    const f = await seedCompanyWithBoardAccess(ctx.db, "Task lifecycle guards");
    const api = app(f.actor);
    const [parent] = await ctx.db.insert(issues).values({ companyId: f.companyId, title: "Parent", status: "done" }).returning();
    const [child] = await ctx.db.insert(issues).values({ companyId: f.companyId, title: "Child", parentId: parent!.id }).returning();
    const parentUrl = `/api/issues/${parent!.id}`;
    const childUrl = `/api/issues/${child!.id}`;
    await api.post(`${childUrl}/task-archive`).expect(409);
    await api.post(`${parentUrl}/task-archive`).expect(409);
    await ctx.db.update(issues).set({ status: "done" }).where(eq(issues.id, child!.id));
    const [agent] = await ctx.db.insert(agents).values({ companyId: f.companyId, name: "Test worker" }).returning();
    const [run] = await ctx.db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: agent!.id, status: "running", invocationSource: "manual", nativeIssueId: child!.id,
    }).returning();
    await api.post(`${childUrl}/task-archive`).expect(409);
    await ctx.db.update(heartbeatRuns).set({ status: "scheduled_retry", scheduledRetryAt: new Date(Date.now() + 60_000) })
      .where(eq(heartbeatRuns.id, run!.id));
    await api.post(`${childUrl}/task-archive`).expect(409);
    await ctx.db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run!.id));
    await api.post(`${parentUrl}/task-archive`).expect(200);
    expect((await api.get(`${parentUrl}/deletion-impact`).expect(200)).body.blockers).toContain("children");
    await api.delete(parentUrl).query({ confirm: parent!.id }).expect(409);
    await api.get(parentUrl).expect(200);
  });
});

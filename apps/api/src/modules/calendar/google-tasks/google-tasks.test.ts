import assert from "node:assert/strict";
import { test } from "node:test";
import { Logger } from "../../../core/logging/logger.js";
import { CalendarTask } from "../domain/calendar-task.js";
import { MemoryTaskRepository } from "../repository/memory-task.repository.js";
import { TaskGoogleSync } from "../services/task-google-sync.js";
import { TaskServiceImpl } from "../services/task.service.impl.js";
import { FakeGoogleTasksClient } from "./fake-google-tasks.client.js";
import { toGoogleTaskBody } from "./google-tasks-mapping.js";
import { HttpGoogleTasksClient, type FetchLike } from "./http-google-tasks.client.js";

const now = "2026-10-23T12:00:00.000Z";
const task = (extra: Partial<{ status: "pending" | "completed"; completedAt: string | null; dueDate: string | null }> = {}) =>
  new CalendarTask("0b5d6f7e-1c2a-4b3d-8e9f-a0b1c2d3e4f5", "alice", "Pagar", "nota", extra.dueDate === undefined ? "2026-10-25" : extra.dueDate, "09:00", extra.status ?? "pending", extra.completedAt ?? null, null, now, now, 1);

test("mapeamento: concluída vira completed no Google, pendente vira needsAction e limpa a conclusão", () => {
  assert.deepEqual(toGoogleTaskBody(task()), { title: "Pagar", notes: "nota", status: "needsAction", due: "2026-10-25T00:00:00.000Z", completed: null });
  const done = toGoogleTaskBody(task({ status: "completed", completedAt: "2026-10-24T08:00:00.000Z" }));
  assert.equal(done.status, "completed");
  assert.equal(done.completed, "2026-10-24T08:00:00.000Z");
  assert.equal(toGoogleTaskBody(task({ dueDate: null })).due, null);
});

test("sincronização desligada não chama o Google nem com cliente presente", async () => {
  const client = new FakeGoogleTasksClient();
  const repository = new MemoryTaskRepository();
  const service = new TaskServiceImpl(repository, new TaskGoogleSync(repository, client, { enabled: false }));
  const { task: created } = await service.create("alice", { title: "x", description: "", dueDate: null, dueTime: null, status: "pending" });
  await service.update("alice", created.id, { version: 1, status: "completed" });
  await service.delete("alice", created.id, 2);
  assert.deepEqual(client.calls, []);
});

test("ligada: cria no Google, grava a referência, propaga conclusão e exclusão", async () => {
  const client = new FakeGoogleTasksClient();
  const repository = new MemoryTaskRepository();
  const service = new TaskServiceImpl(repository, new TaskGoogleSync(repository, client, { enabled: true, now: () => new Date(now) }));
  const { task: created } = await service.create("alice", { title: "Pagar", description: "", dueDate: "2026-10-25", dueTime: null, status: "pending" });
  assert.equal(created.external?.provider, "google");
  assert.equal(created.version, 1);
  const remoteId = created.external!.taskId;
  assert.equal(client.tasks.get(`@default/${remoteId}`)?.status, "needsAction");
  await service.update("alice", created.id, { version: 1, status: "completed" });
  assert.equal(client.tasks.get(`@default/${remoteId}`)?.status, "completed");
  await service.update("alice", created.id, { version: 2, status: "pending" });
  assert.equal(client.tasks.get(`@default/${remoteId}`)?.status, "needsAction");
  await service.delete("alice", created.id, 3);
  assert.equal(client.tasks.size, 0);
  assert.deepEqual(client.calls, ["insert", "update", "update", "delete"]);
});

test("falha do Google não desfaz a gravação local", async () => {
  const client = new FakeGoogleTasksClient();
  const repository = new MemoryTaskRepository();
  const service = new TaskServiceImpl(repository, new TaskGoogleSync(repository, client, { enabled: true }));
  client.nextError = "unavailable";
  const { task: created } = await service.create("alice", { title: "Local", description: "", dueDate: null, dueTime: null, status: "pending" });
  assert.equal(created.external, null);
  assert.equal((await repository.findById("alice", created.id))?.title, "Local");
});

test("cliente HTTP: monta URL, cabeçalho e corpo; classifica erros sem vazar o corpo", async () => {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let status = 200;
  const doFetch: FetchLike = async (url, init) => { seen.push({ url, ...init }); return { ok: status < 400, status, json: async () => ({ id: "t1", status: "completed" }) }; };
  const client = new HttpGoogleTasksClient({ accessToken: async (owner) => `token-de-${owner}` }, doFetch);
  const body = toGoogleTaskBody(task());
  assert.equal((await client.insertTask("alice", "@default", body)).id, "t1");
  assert.equal(seen[0].url, "https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers.authorization, "Bearer token-de-alice");
  assert.equal(JSON.parse(seen[0].body!).status, "needsAction");
  await client.updateTask("alice", "@default", "t1", body);
  assert.equal(seen[1].method, "PATCH");
  assert.ok(seen[1].url.endsWith("/tasks/t1"));
  await client.deleteTask("alice", "@default", "t1");
  assert.equal(seen[2].method, "DELETE");
  for (const [code, kind] of [[401, "unauthorized"], [404, "not_found"], [429, "rate_limited"], [503, "unavailable"], [400, "invalid"]] as const) {
    status = code;
    await assert.rejects(client.updateTask("alice", "@default", "t1", body), { message: `google-tasks:${kind}`, status: code });
  }
});

test("falhas do Google são registradas com operação, tipo e status, sem título nem token; not_found na exclusão não é falha", async () => {
  const lines: string[] = [];
  const client = new FakeGoogleTasksClient();
  const sync = new TaskGoogleSync(new MemoryTaskRepository(), client, { enabled: true, log: new Logger("debug", line => lines.push(line), { format: "json" }) });
  const local = task();
  client.nextError = "unavailable";
  assert.equal((await sync.afterSave(local)).outcome, "failed");
  const linked = new CalendarTask(local.id, local.ownerId, local.title, local.description, local.dueDate, local.dueTime, local.status, local.completedAt,
    { provider: "google", taskListId: "@default", taskId: "t1", syncedAt: now }, local.createdAt, local.updatedAt, local.version);
  client.nextError = "rate_limited";
  assert.equal((await sync.afterSave(linked)).outcome, "failed");
  client.nextError = "unauthorized";
  assert.equal(await sync.afterDelete(linked), "failed");
  client.nextError = "not_found";
  assert.equal(await sync.afterDelete(linked), "synced");
  const entries = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(entries.map(e => [e.level, e.service, e.operation, e.detail]), [
    ["warn", "Google Tasks", "criar tarefa", "unavailable"], ["warn", "Google Tasks", "atualizar tarefa", "rate_limited"], ["warn", "Google Tasks", "excluir tarefa", "unauthorized"],
  ]);
  assert.equal(lines.join("").includes(local.title), false);
});

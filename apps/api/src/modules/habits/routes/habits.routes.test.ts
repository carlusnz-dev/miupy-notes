import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import express from "express";
import { createApp } from "../../../app.js";
import { errorHandler } from "../../../core/http/error-handler.js";
import { HabitsController } from "../controllers/habits.controller.js";
import type { HabitOutput, OccurrenceOutput } from "../dto/output.js";
import { MemoryHabitsRepository } from "../repository/memory-habits.repository.js";
import { HabitsServiceImpl } from "../services/habits.service.impl.js";
import { createHabitsRouter } from "./habits.routes.js";

const repository = new MemoryHabitsRepository();
const clock = new Date("2026-10-26T12:00:00.000Z");
const app = express();
app.use(express.json());
app.use((req, res, next) => { res.locals.requestId = randomUUID(); const ownerId = req.header("x-test-owner"); if (ownerId) res.locals.principal = { ownerId }; next(); });
app.use("/v1/habits", createHabitsRouter(new HabitsController(new HabitsServiceImpl(repository, () => clock), { googleCalendar: { enabled: false, available: false } })));
app.use(errorHandler);
const server = createServer(app);
let base = "";
before(async () => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw Error("Porta indisponível"); base = `http://127.0.0.1:${address.port}/v1/habits`; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const call = (owner: string, path = "", method = "GET", body?: unknown) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", ...(owner ? { "x-test-owner": owner } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status); const body = await response.json() as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, code); assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
}
async function create(owner: string, input: Record<string, unknown> = {}) {
  const response = await call(owner, "", "POST", { title: "Ler", recurrence: { type: "daily" }, startDate: "2026-10-01", ...input });
  assert.equal(response.status, 201); return await response.json() as HabitOutput;
}
const range = "?from=2026-10-26&to=2026-10-27";

test("sem identidade: 401 em todas as operações e nada é gravado; sem autenticação /v1/habits não existe", async () => {
  const id = randomUUID(), before = (await repository.list("anon")).length;
  for (const [path, method, body] of [
    ["", "GET"], ["", "POST", { title: "x", recurrence: { type: "daily" }, startDate: "2026-10-01" }], [`/${id}`, "GET"], [`/${id}`, "PATCH", { version: 1, title: "x" }], [`/${id}`, "DELETE"],
    [`/${id}/restore`, "POST", {}], [`/${id}/pause`, "POST", { version: 1, from: "2026-10-26" }], [`/${id}/resume`, "POST", { version: 1, on: "2026-10-26" }],
    [`/occurrences${range}`, "GET"], [`/${id}/occurrences/2026-10-26`, "PUT", { status: "completed" }], [`/history${range}`, "GET"], ["/xp", "GET"], ["/settings", "GET"],
  ] as const) await expectError(await call("", path, method, body), 401, "UNAUTHORIZED");
  assert.equal((await repository.list("anon")).length, before); assert.equal((await repository.listXpEvents("anon")).length, 0);
  const publicServer = createServer(createApp());
  await new Promise<void>(resolve => publicServer.listen(0, "127.0.0.1", resolve));
  try { const address = publicServer.address(); if (!address || typeof address === "string") throw Error(); assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/habits`)).status, 404); }
  finally { await new Promise<void>(resolve => publicServer.close(() => resolve())); }
});

test("CRUD: padrões, saída sem ownerId, PATCH versionado com CAS concorrente", async () => {
  const habit = await create("crud", { description: "20 páginas", priority: "high", time: "07:30", recurrence: { type: "weekdays", days: [1, 3, 5] } });
  assert.equal("ownerId" in habit, false); assert.equal(habit.version, 1); assert.equal(habit.kind, "other"); assert.deepEqual(habit.pauses, []);
  assert.deepEqual(await (await call("crud", `/${habit.id}`)).json(), habit);
  const responses = await Promise.all(["A", "B"].map(title => call("crud", `/${habit.id}`, "PATCH", { version: 1, title })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(((await (await call("crud")).json()) as { items: HabitOutput[] }).items.length, 1);
});

test("isolamento: B não lê, edita, conclui, pausa, exclui nem vê XP/histórico de A", async () => {
  const habit = await create("alice");
  assert.equal((await call("alice", `/${habit.id}/occurrences/2026-10-26`, "PUT", { status: "completed" })).status, 200);
  for (const [path, method, body] of [
    [`/${habit.id}`, "GET"], [`/${habit.id}`, "PATCH", { version: 1, title: "Roubo" }], [`/${habit.id}`, "DELETE"], [`/${habit.id}/restore`, "POST", {}],
    [`/${habit.id}/pause`, "POST", { version: 1, from: "2026-10-26" }], [`/${habit.id}/resume`, "POST", { version: 1, on: "2026-10-26" }],
    [`/${habit.id}/occurrences/2026-10-26`, "PUT", { status: "pending" }],
  ] as const) await expectError(await call("bob", path, method, body), 404, "NOT_FOUND");
  assert.deepEqual(await (await call("bob")).json(), { items: [] });
  assert.deepEqual(await (await call("bob", "?trash=true")).json(), { items: [] });
  assert.deepEqual(await (await call("bob", `/occurrences${range}`)).json(), { items: [] });
  assert.deepEqual(await (await call("bob", `/history?from=2026-10-01&to=2026-10-31`)).json(), { items: [] });
  assert.equal(((await (await call("bob", "/xp")).json()) as { totalXp: number }).totalXp, 0);
  const mine = await (await call("alice", `/${habit.id}`)).json() as HabitOutput;
  assert.equal(mine.version, 1); assert.equal(mine.title, "Ler"); assert.equal(mine.deletedAt, null);
  assert.equal(((await (await call("alice", "/xp")).json()) as { totalXp: number }).totalXp, 10);
});

test("ocorrências do dia, conclusão por data, lixeira e restauração pela API", async () => {
  const habit = await create("flow", { time: "08:00", priority: "low" });
  const put = (status: string) => call("flow", `/${habit.id}/occurrences/2026-10-26`, "PUT", { status });
  const done = await (await put("completed")).json() as OccurrenceOutput;
  assert.equal(done.status, "completed"); assert.equal(done.points, 5);
  const list = await (await call("flow", `/occurrences${range}`)).json() as { items: OccurrenceOutput[] };
  assert.deepEqual(list.items.map(o => [o.date, o.status, o.time]), [["2026-10-26", "completed", "08:00"], ["2026-10-27", "pending", "08:00"]]);
  const removed = await (await call("flow", `/${habit.id}`, "DELETE")).json() as HabitOutput;
  assert.ok(removed.deletedAt && removed.purgeAfter);
  assert.deepEqual(await (await call("flow", `/occurrences${range}`)).json(), { items: [] });
  assert.equal(((await (await call("flow", "?trash=true")).json()) as { items: unknown[] }).items.length, 1);
  assert.equal((await call("flow", `/${habit.id}/restore`, "POST")).status, 200);
  assert.equal((await put("pending")).status, 200);
  assert.equal(((await (await call("flow", "/xp")).json()) as { totalXp: number }).totalXp, 0);
  assert.deepEqual(await (await call("flow", "/settings")).json(), { googleCalendar: { enabled: false, available: false } });
});

test("valida payload, datas, intervalos e queries estritas", async () => {
  for (const input of [
    { ownerId: "bob" }, { title: " " }, { title: "a".repeat(201) }, { kind: "x" }, { priority: "urgent" }, { time: "24:00" }, { time: "7:30" },
    { recurrence: { type: "monthly" } }, { recurrence: { type: "daily", every: 0 } }, { recurrence: { type: "weekdays", days: [] } },
    { recurrence: { type: "weekdays", days: [7] } }, { recurrence: { type: "weekdays", days: [1, 1] } }, { startDate: "2026-02-30" },
    { endDate: "2026-09-01" }, { description: "a".repeat(1001) }, { deletedAt: "2026-10-26T00:00:00.000Z" },
  ]) await expectError(await call("v", "", "POST", { title: "x", recurrence: { type: "daily" }, startDate: "2026-10-01", ...input }), 400, "VALIDATION_ERROR");
  const habit = await create("v");
  for (const body of [{ version: 1 }, { title: "x" }, { version: 0, title: "x" }, { version: 1, deletedAt: null }, { version: 1, pauses: [] }]) await expectError(await call("v", `/${habit.id}`, "PATCH", body), 400, "VALIDATION_ERROR");
  await expectError(await call("v", `/${habit.id}/pause`, "POST", { version: 1, from: "2026-10-26", until: "2026-10-26" }), 400, "VALIDATION_ERROR");
  for (const query of ["", "?from=2026-10-26", "?from=2026-10-27&to=2026-10-26", "?from=2026-01-01&to=2026-12-31", "?from=2026-10-26&to=2026-10-27&ownerId=bob", "?from=x&to=y"]) await expectError(await call("v", `/occurrences${query}`), 400, "VALIDATION_ERROR");
  await expectError(await call("v", "?trash=maybe"), 400, "VALIDATION_ERROR");
  await expectError(await call("v", "/bad-id"), 400, "VALIDATION_ERROR");
  await expectError(await call("v", `/${habit.id}/occurrences/2026-02-30`, "PUT", { status: "completed" }), 400, "VALIDATION_ERROR");
  await expectError(await call("v", `/${habit.id}/occurrences/2026-10-26`, "PUT", { status: "done" }), 400, "VALIDATION_ERROR");
  await expectError(await call("v", `/${habit.id}/occurrences/2030-01-01`, "PUT", { status: "completed" }), 400, "VALIDATION_ERROR");
});

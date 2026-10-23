import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createKit, createTestServer } from "../calendar.test-kit.js";

const kit = createKit();
const server = createTestServer(kit);
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1/calendar`;
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type TaskBody = { id: string; title: string; dueDate: string | null; dueTime: string | null; status: string; completedAt: string | null; inGoogle: boolean; version: number; ownerId?: string };

function call(owner: string | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) headers["x-test-owner"] = owner;
  return fetch(`${baseUrl}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
async function create(owner: string, body: object): Promise<TaskBody> {
  const response = await call(owner, "/tasks", { method: "POST", body });
  assert.ok(response.status === 201 || response.status === 200, `criação respondeu ${response.status}`);
  return await response.json() as TaskBody;
}

test("sem principal, as rotas de tarefa respondem 401", async () => {
  assert.equal((await call(null, "/tasks")).status, 401);
  assert.equal((await call(null, "/tasks", { method: "POST", body: { title: "x" } })).status, 401);
});

test("criar tarefa guarda prazo e status pendente, e nunca devolve ownerId", async () => {
  const task = await create("alice", { title: "Pagar boleto", dueDate: "2026-11-05", dueTime: "09:30" });
  assert.deepEqual([task.status, task.dueDate, task.dueTime, task.completedAt, task.inGoogle, task.version], ["pending", "2026-11-05", "09:30", null, false, 1]);
  assert.equal(task.ownerId, undefined);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { title: "x", ownerId: "bob" } })).status, 400);
});

test("prazo inválido é recusado: data irreal, hora fora do padrão e hora sem data", async () => {
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { title: "x", dueDate: "2026-02-30" } })).status, 400);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { title: "x", dueDate: "2026-11-05", dueTime: "25:00" } })).status, 400);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { title: "x", dueTime: "09:00" } })).status, 400);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { title: "   " } })).status, 400);
});

test("tarefa sem prazo é aceita", async () => {
  const task = await create("alice", { title: "Algum dia" });
  assert.deepEqual([task.dueDate, task.dueTime], [null, null]);
});

test("repetir o POST com o mesmo id e conteúdo é idempotente; conteúdo diferente é 409", async () => {
  const id = "7b0f3c1a-5d2e-4f6a-8b9c-0d1e2f3a4b5c";
  const first = await call("alice", "/tasks", { method: "POST", body: { id, title: "Ligar" } });
  assert.equal(first.status, 201);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { id, title: "Ligar" } })).status, 200);
  assert.equal((await call("alice", "/tasks", { method: "POST", body: { id, title: "Outra coisa" } })).status, 409);
});

test("concluir grava completedAt, reabrir limpa e editar uma concluída preserva o instante", async () => {
  const task = await create("alice", { title: "Revisar" });
  const done = await (await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 1, status: "completed" } })).json() as TaskBody;
  assert.equal(done.status, "completed");
  assert.ok(done.completedAt);
  assert.equal(done.version, 2);
  const renamed = await (await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 2, title: "Revisar de novo" } })).json() as TaskBody;
  assert.equal(renamed.completedAt, done.completedAt);
  const reopened = await (await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 3, status: "pending" } })).json() as TaskBody;
  assert.deepEqual([reopened.status, reopened.completedAt], ["pending", null]);
});

test("atualizar com versão antiga é 409; hora sem data após limpar a data é 400", async () => {
  const task = await create("alice", { title: "Comprar", dueDate: "2026-11-06", dueTime: "10:00" });
  assert.equal((await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 9, title: "x" } })).status, 409);
  assert.equal((await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 1, dueDate: null } })).status, 400);
  const cleared = await (await call("alice", `/tasks/${task.id}`, { method: "PATCH", body: { version: 1, dueDate: null, dueTime: null } })).json() as TaskBody;
  assert.deepEqual([cleared.dueDate, cleared.dueTime], [null, null]);
});

test("lista filtra por status e pagina por cursor", async () => {
  const owner = "carol";
  const a = await create(owner, { title: "A" });
  await create(owner, { title: "B" });
  await create(owner, { title: "C", status: "completed" });
  await call(owner, `/tasks/${a.id}`, { method: "PATCH", body: { version: 1, status: "completed" } });
  const pending = await (await call(owner, "/tasks?status=pending")).json() as { items: TaskBody[] };
  assert.deepEqual(pending.items.map((task) => task.title), ["B"]);
  const first = await (await call(owner, "/tasks?limit=2")).json() as { items: TaskBody[]; nextCursor: string | null };
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await (await call(owner, `/tasks?limit=2&cursor=${first.nextCursor}`)).json() as { items: TaskBody[]; nextCursor: string | null };
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal((await call(owner, "/tasks?status=outro")).status, 400);
});

test("tarefa de outro proprietário responde 404 e não aparece na lista", async () => {
  const task = await create("alice", { title: "Privada" });
  assert.equal((await call("bob", `/tasks/${task.id}`)).status, 404);
  assert.equal((await call("bob", `/tasks/${task.id}`, { method: "PATCH", body: { version: 1, title: "x" } })).status, 404);
  assert.equal((await call("bob", `/tasks/${task.id}?version=1`, { method: "DELETE" })).status, 404);
  const listed = await (await call("bob", "/tasks")).json() as { items: TaskBody[] };
  assert.ok(!listed.items.some((item) => item.id === task.id));
});

test("excluir exige a versão atual", async () => {
  const task = await create("alice", { title: "Apagar" });
  assert.equal((await call("alice", `/tasks/${task.id}`, { method: "DELETE" })).status, 400);
  assert.equal((await call("alice", `/tasks/${task.id}?version=7`, { method: "DELETE" })).status, 409);
  assert.equal((await call("alice", `/tasks/${task.id}?version=1`, { method: "DELETE" })).status, 204);
  assert.equal((await call("alice", `/tasks/${task.id}`)).status, 404);
});

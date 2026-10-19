import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import { errorHandler } from "../../../core/http/error-handler.js";
import { FoldersController } from "../controllers/folders.controller.js";
import { MemoryFoldersRepository } from "../repository/memory-folders.repository.js";
import { FoldersServiceImpl } from "../services/folders.service.impl.js";
import { createFoldersRouter } from "./folders.routes.js";

// Principal falso, só no teste; o app público só monta /v1 com verificação real de token.
function createTestApp() {
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    const owner = req.header("x-test-owner");
    if (owner) res.locals.principal = { ownerId: owner };
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  const service = new FoldersServiceImpl(new MemoryFoldersRepository());
  app.use("/v1/folders", createFoldersRouter(new FoldersController(service)));
  app.use(errorHandler);
  return app;
}

const server = createServer(createTestApp());
let baseUrl = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1/folders`;
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type FolderBody = { id: string; name: string; parentId: string | null; version: number };

function call(owner: string | null, path = "", init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) headers["x-test-owner"] = owner;
  return fetch(`${baseUrl}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function errorCode(response: Response, status: number) {
  assert.equal(response.status, status);
  const body = await response.json() as { error: { code: string; requestId: string } };
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
  return body.error.code;
}

test("rotas exigem principal", async () => {
  assert.equal(await errorCode(await call(null), 401), "UNAUTHORIZED");
  assert.equal(await errorCode(await call(null, "", { method: "POST", body: { name: "x" } }), 401), "UNAUTHORIZED");
});

test("criar, listar e renomear pastas, sem ownerId na resposta", async () => {
  const created = await call("alice", "", { method: "POST", body: { name: "  Ideias  " } });
  assert.equal(created.status, 201);
  const folder = await created.json() as FolderBody;
  assert.deepEqual(Object.keys(folder).sort(), ["createdAt", "id", "name", "parentId", "updatedAt", "version"]);
  assert.equal(folder.name, "Ideias");
  assert.equal(folder.parentId, null);

  await call("alice", "", { method: "POST", body: { name: "Filha", parentId: folder.id } });
  const list = await (await call("alice")).json() as { items: FolderBody[] };
  assert.deepEqual(list.items.map((item) => item.name), ["Filha", "Ideias"]);

  const renamed = await call("alice", `/${folder.id}`, { method: "PATCH", body: { name: "Arquivo", version: 1 } });
  assert.equal(renamed.status, 200);
  const body = await renamed.json() as FolderBody;
  assert.equal(body.version, 2);
  assert.equal(body.name, "Arquivo");
  assert.equal(await errorCode(await call("alice", `/${folder.id}`, { method: "PATCH", body: { name: "Velha", version: 1 } }), 409), "CONFLICT");
});

test("mover e excluir pastas não são suportados: PATCH com parentId é 400 e DELETE não existe", async () => {
  const parent = await (await call("alice", "", { method: "POST", body: { name: "Pai" } })).json() as FolderBody;
  const child = await (await call("alice", "", { method: "POST", body: { name: "Filha", parentId: parent.id } })).json() as FolderBody;
  assert.equal(await errorCode(await call("alice", `/${child.id}`, { method: "PATCH", body: { parentId: null, version: 1 } }), 400), "VALIDATION_ERROR");
  assert.equal(await errorCode(await call("alice", `/${parent.id}`, { method: "PATCH", body: { parentId: child.id, name: "Pai", version: 1 } }), 400), "VALIDATION_ERROR");
  // Sem rota DELETE; o JSON 404 de rota inexistente vem do createApp (coberto em app.test.ts).
  assert.equal((await call("alice", `/${child.id}`, { method: "DELETE" })).status, 404);
  const list = await (await call("alice")).json() as { items: FolderBody[] };
  assert.equal(list.items.find((item) => item.id === child.id)?.parentId, parent.id, "nada mudou");
});

test("isolamento: outro proprietário não lista nem renomeia", async () => {
  const folder = await (await call("alice", "", { method: "POST", body: { name: "Privada" } })).json() as FolderBody;
  assert.deepEqual(((await (await call("bob")).json()) as { items: unknown[] }).items, []);
  assert.equal(await errorCode(await call("bob", `/${folder.id}`, { method: "PATCH", body: { name: "X", version: 1 } }), 404), "NOT_FOUND");
  assert.equal(await errorCode(await call("bob", "", { method: "POST", body: { name: "Filha", parentId: folder.id } }), 400), "VALIDATION_ERROR");
});

test("valida corpo e ID", async () => {
  const cases: Array<[string, { method?: string; body?: unknown }]> = [
    ["", { method: "POST", body: { name: "" } }],
    ["", { method: "POST", body: { name: "   " } }],
    ["", { method: "POST", body: { name: "x".repeat(101) } }],
    ["", { method: "POST", body: { name: "x", ownerId: "bob" } }],
    ["", { method: "POST", body: { name: "x", parentId: "nao-uuid" } }],
    ["/nao-uuid", { method: "PATCH", body: { name: "x", version: 1 } }],
    [`/${randomUUID()}`, { method: "PATCH", body: { version: 1 } }],
    [`/${randomUUID()}`, { method: "PATCH", body: { name: "x" } }],
  ];
  for (const [path, init] of cases) assert.equal(await errorCode(await call("alice", path, init), 400), "VALIDATION_ERROR", `${init.method} ${path} ${JSON.stringify(init.body)}`);
});

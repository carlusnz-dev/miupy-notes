import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import express from "express";
import { createDataModules } from "./compose.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { errorHandler } from "./core/http/error-handler.js";

// Integração com DynamoDB Local: roda só com DYNAMODB_TEST_ENDPOINT (ex.: http://127.0.0.1:8011) e usa
// uma tabela própria, criada e removida aqui. Recusa qualquer endpoint fora de loopback.
const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
const skip = endpoint ? false : "defina DYNAMODB_TEST_ENDPOINT (DynamoDB Local) para rodar";
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)) throw new Error("DYNAMODB_TEST_ENDPOINT deve apontar para o DynamoDB Local.");

const tableName = `miupy-test-${randomUUID()}`;
const dynamo = endpoint ? createDynamoClient(endpoint) : null;
const admin = endpoint ? new DynamoDBClient({ endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } }) : null;
const server = createServer();
let baseUrl = "";

before(async () => {
  if (!endpoint || !dynamo || !admin) return;
  await admin.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
  }));
  const { notes, folders } = createDataModules(dynamo, tableName);
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    const owner = req.header("x-test-owner");
    if (owner) res.locals.principal = { ownerId: owner };
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use("/v1/notes", notes.router);
  app.use("/v1/folders", folders.router);
  app.use(errorHandler);
  server.on("request", app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (admin) await admin.send(new DeleteTableCommand({ TableName: tableName }));
});

type Json = Record<string, unknown>;
async function call(owner: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-test-owner": owner },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() as Json : null };
}

test("pastas e notas persistem no DynamoDB; notas movem entre pastas com versão", { skip }, async () => {
  const folder = (await call("alice", "/folders", { method: "POST", body: { name: "Projetos" } })).body!;
  const sub = (await call("alice", "/folders", { method: "POST", body: { name: "2026", parentId: folder.id } })).body!;
  const note = (await call("alice", "/notes", { method: "POST", body: { title: "Sem título", folderId: sub.id } })).body!;
  assert.equal(note.folderId, sub.id);

  assert.deepEqual(((await call("alice", "/folders")).body!.items as Json[]).map((item) => item.name), ["2026", "Projetos"]);
  const notes = (await call("alice", "/notes")).body!.items as Json[];
  assert.deepEqual(notes.map((item) => item.id), [note.id], "a listagem de notas não inclui pastas");

  const renamed = await call("alice", `/folders/${sub.id}`, { method: "PATCH", body: { name: "Arquivo", version: 1 } });
  assert.equal(renamed.body!.version, 2);
  assert.equal(renamed.body!.parentId, folder.id);
  assert.equal((await call("alice", `/folders/${sub.id}`, { method: "PATCH", body: { name: "Velha", version: 1 } })).status, 409);
  assert.equal((await call("alice", `/folders/${sub.id}`, { method: "PATCH", body: { parentId: null, version: 2 } })).status, 400, "mover pasta não é suportado");
  assert.equal((await call("alice", `/folders/${sub.id}`, { method: "DELETE" })).status, 404, "excluir pasta não é suportado");

  const moved = await call("alice", `/notes/${note.id}`, { method: "PATCH", body: { folderId: folder.id, version: 1 } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body!.version, 2);
  assert.equal((await call("alice", `/notes/${note.id}`, { method: "PATCH", body: { folderId: null, version: 1 } })).status, 409);
  assert.equal((await call("alice", `/notes/${note.id}`)).body!.folderId, folder.id);
  assert.equal((await call("alice", `/notes/${note.id}`, { method: "PATCH", body: { folderId: null, version: 2 } })).body!.folderId, null);
});

test("isolamento por proprietário em pastas e movimentos", { skip }, async () => {
  const folder = (await call("alice", "/folders", { method: "POST", body: { name: "Privada" } })).body!;
  const note = (await call("alice", "/notes", { method: "POST", body: { title: "Minha" } })).body!;
  assert.deepEqual((await call("bob", "/folders")).body, { items: [] });
  assert.equal((await call("bob", `/folders/${folder.id}`, { method: "PATCH", body: { name: "X", version: 1 } })).status, 404);
  assert.equal((await call("bob", "/notes", { method: "POST", body: { title: "x", folderId: folder.id } })).status, 400);
  assert.equal((await call("alice", `/notes/${note.id}`, { method: "PATCH", body: { folderId: folder.id, version: 1 } })).status, 200);
  assert.equal((await call("bob", `/notes/${note.id}`, { method: "PATCH", body: { folderId: null, version: 2 } })).status, 404);
  assert.equal((await call("alice", `/notes/${note.id}`)).body!.folderId, folder.id);
});

test("notas gravadas antes das pastas (sem folderId) leem na raiz e o corpo volta byte a byte", { skip }, async () => {
  const id = randomUUID();
  const now = "2026-10-01T00:00:00.000Z";
  await dynamo!.send(new PutCommand({ TableName: tableName, Item: { pk: "USER#carol", sk: `NOTE#${id}`, id, ownerId: "carol", title: "Antiga", body: "x", tags: [], createdAt: now, updatedAt: now, version: 1 } }));
  assert.equal((await call("carol", `/notes/${id}`)).body!.folderId, null);

  const body = "# T  \r\n\r\n**a** _b_ ~~c~~ `d`\r\n- [ ] x\r\n- [x] y\r\n\r\n```ts\nconst a = 1;\n```\n| a | b |\n|---|---|\n\té 🙂 \n\n";
  assert.equal((await call("carol", `/notes/${id}`, { method: "PATCH", body: { body, version: 1 } })).status, 200);
  assert.equal((await call("carol", `/notes/${id}`)).body!.body, body);
});

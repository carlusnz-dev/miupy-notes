import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import { errorHandler } from "../../../core/http/error-handler.js";
import { NotesController } from "../controllers/notes.controller.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { NotesServiceImpl } from "../services/notes.service.impl.js";
import { createNotesRouter } from "./notes.routes.js";

// Principal falso, só no teste: o app público não monta /v1/notes até existir verificação real de token.
function createTestApp() {
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    const owner = req.header("x-test-owner");
    if (owner) res.locals.principal = { ownerId: owner };
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use("/v1/notes", createNotesRouter(new NotesController(new NotesServiceImpl(new MemoryNotesRepository()))));
  app.use(errorHandler);
  return app;
}

const server = createServer(createTestApp());
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1/notes`;
});

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type ErrorBody = { error: { code: string; message: string; requestId: string } };
type NoteBody = { id: string; title: string; body: string; tags: string[]; version: number; createdAt: string; updatedAt: string };
type PageBody = { items: NoteBody[]; nextCursor: string | null };

function call(owner: string | null, path = "", init: { method?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) headers["x-test-owner"] = owner;
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return fetch(`${baseUrl}${path}`, { method: init.method ?? "GET", headers, body });
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json() as ErrorBody;
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, "string");
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(body), ["error"]);
}

async function createNote(owner: string, title: string): Promise<NoteBody> {
  const response = await call(owner, "", { method: "POST", body: { title, body: "# Markdown", tags: ["teste"] } });
  assert.equal(response.status, 201);
  return await response.json() as NoteBody;
}

test("rotas exigem principal e respondem 401 no formato de erro", async () => {
  await expectError(await call(null), 401, "UNAUTHORIZED");
  await expectError(await call(null, "", { method: "POST", body: { title: "x" } }), 401, "UNAUTHORIZED");
  await expectError(await call(null, `/${randomUUID()}`, { method: "DELETE" }), 401, "UNAUTHORIZED");
});

test("CRUD completo com versão e sem expor ownerId", async () => {
  const created = await createNote("alice", "Primeira");
  assert.equal(created.version, 1);
  assert.equal("ownerId" in created, false);

  const read = await call("alice", `/${created.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), created);

  const patched = await call("alice", `/${created.id}`, { method: "PATCH", body: { title: "Revisada", version: 1 } });
  assert.equal(patched.status, 200);
  const patchedBody = await patched.json() as NoteBody;
  assert.equal(patchedBody.title, "Revisada");
  assert.equal(patchedBody.body, "# Markdown");
  assert.equal(patchedBody.version, 2);

  await expectError(await call("alice", `/${created.id}`, { method: "PATCH", body: { title: "Antiga", version: 1 } }), 409, "CONFLICT");

  const deleted = await call("alice", `/${created.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  await expectError(await call("alice", `/${created.id}`), 404, "NOT_FOUND");
  await expectError(await call("alice", `/${created.id}`, { method: "DELETE" }), 404, "NOT_FOUND");
});

test("lista pagina por cursor sem repetir nem pular notas", async () => {
  const owner = "paginacao";
  const ids = new Set<string>();
  for (const title of ["a", "b", "c"]) ids.add((await createNote(owner, title)).id);

  const first = await (await call(owner, "?limit=2")).json() as PageBody;
  assert.equal(first.items.length, 2);
  assert.equal(typeof first.nextCursor, "string");
  const second = await (await call(owner, `?limit=2&cursor=${first.nextCursor}`)).json() as PageBody;
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map((note) => note.id)), ids);
});

test("um usuário não lê, altera, exclui nem lista notas de outro", async () => {
  const note = await createNote("dona", "Privada");
  await expectError(await call("intruso", `/${note.id}`), 404, "NOT_FOUND");
  await expectError(await call("intruso", `/${note.id}`, { method: "PATCH", body: { title: "x", version: 1 } }), 404, "NOT_FOUND");
  await expectError(await call("intruso", `/${note.id}`, { method: "DELETE" }), 404, "NOT_FOUND");
  const page = await (await call("intruso")).json() as PageBody;
  assert.deepEqual(page, { items: [], nextCursor: null });
  assert.equal((await call("dona", `/${note.id}`)).status, 200);
});

test("ownerId enviado pelo cliente é rejeitado, não usado", async () => {
  await expectError(await call("alice", "", { method: "POST", body: { title: "x", ownerId: "bob" } }), 400, "VALIDATION_ERROR");
  const note = await createNote("alice", "Minha");
  await expectError(await call("alice", `/${note.id}`, { method: "PATCH", body: { ownerId: "bob", title: "y", version: 1 } }), 400, "VALIDATION_ERROR");
});

test("validação Zod e erros de corpo respondem no formato padrão", async () => {
  const note = await createNote("validacao", "Base");
  const cases: Array<[string, Parameters<typeof call>[2], number, string]> = [
    ["/nao-e-uuid", {}, 400, "VALIDATION_ERROR"],
    ["", { method: "POST", body: { title: "   " } }, 400, "VALIDATION_ERROR"],
    ["", { method: "POST", body: { title: "x", tags: Array(21).fill("t") } }, 400, "VALIDATION_ERROR"],
    [`/${note.id}`, { method: "PATCH", body: { version: 1 } }, 400, "VALIDATION_ERROR"],
    [`/${note.id}`, { method: "PATCH", body: { title: "x" } }, 400, "VALIDATION_ERROR"],
    [`/${note.id}`, { method: "PATCH", body: { title: "x", version: 0 } }, 400, "VALIDATION_ERROR"],
    ["?limit=0", {}, 400, "VALIDATION_ERROR"],
    ["?limit=101", {}, 400, "VALIDATION_ERROR"],
    ["?ownerId=bob", {}, 400, "VALIDATION_ERROR"],
    ["", { method: "POST", raw: "{\"title\":" }, 400, "VALIDATION_ERROR"],
    ["", { method: "POST", body: { title: "x", body: "a".repeat(300_000) } }, 413, "PAYLOAD_TOO_LARGE"],
  ];
  for (const [path, init, status, code] of cases) await expectError(await call("validacao", path, init), status, code);
});

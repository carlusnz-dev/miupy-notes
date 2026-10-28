import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import type { Router } from "express";
import { createApp } from "../../../app.js";
import { createDataModules } from "../../../compose.js";
import { authenticate, bearerTokenClaims, parseAllowedSubs } from "../../../core/http/authenticate.js";
import { Logger } from "../../../core/logging/logger.js";
import { NotesController } from "../controllers/notes.controller.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { NotesServiceImpl } from "../services/notes.service.impl.js";
import { createNotesRouter } from "./notes.routes.js";

const audience = "security-test.apps.googleusercontent.com";
const id = "00000000-0000-4000-8000-000000000001";
const modules = createDataModules({} as never, "unused-test-table");
const notesRouter = createNotesRouter(new NotesController(new NotesServiceImpl(new MemoryNotesRepository(), { exists: async () => false })));
const mounted = [
  ["notes", modules.notes.router], ["folders", modules.folders.router],
  ["finance", modules.finance.router], ["calendar", modules.calendar.router],
  ["library", modules.library.router],
] as const;

// A lista vem dos routers registrados; uma rota nova entra no teste sem editar fixtures.
function registeredRoutes(router: Router) {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
  return stack.flatMap(({ route }) => route
    ? Object.keys(route.methods).filter((method) => route.methods[method]).map((method) => ({ method: method.toUpperCase(), path: route.path.replaceAll(":id", id) }))
    : []);
}

let signingKey: CryptoKey;
let baseUrl = "";
let server: ReturnType<typeof createServer>;

function token(expiration: number | string = "1h", subject = "owner-a") {
  return new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "security-key" })
    .setSubject(subject).setIssuer("https://accounts.google.com")
    .setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(signingKey);
}

before(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "security-key", alg: "RS256" }] });
  server = createServer(createApp({
    authenticate: authenticate(bearerTokenClaims(jwks, audience), parseAllowedSubs("owner-a,owner-b")),
    notesRouter, foldersRouter: modules.folders.router,
    financeRouter: modules.finance.router, calendarRouter: modules.calendar.router,
    libraryRouter: modules.library.router,
  }, new Logger("error", () => {})));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

test("todas as rotas registradas rejeitam ausência, token inválido/expirado e formato indevido", async () => {
  const valid = await token();
  const invalid = [undefined, "Basic abc", "Bearer nao-e-jwt", `Bearer ${await token(Math.floor(Date.now() / 1000) - 60)}`, `Bearer ${valid} extra`];
  const routes = mounted.flatMap(([prefix, router]) => registeredRoutes(router).map(({ method, path }) => ({ method, path: `/v1/${prefix}${path === "/" ? "" : path}` })));
  assert.ok(routes.length >= 30, `Inventário inesperadamente pequeno: ${routes.length}`);
  for (const { method, path } of routes) {
    for (const authorization of invalid) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers: authorization ? { authorization } : {} });
      assert.equal(response.status, 401, `${method} ${path}: ${authorization ? "token fornecido" : "sem token"}`);
      const body = await response.json() as { error: { code: string } };
      assert.equal(body.error.code, "UNAUTHORIZED", `${method} ${path}`);
    }
  }
});

test("rotas desconhecidas em /v1 também exigem identidade; health segue público", async () => {
  const protectedUnknown = await fetch(`${baseUrl}/v1/rota-inexistente`);
  assert.equal(protectedUnknown.status, 401);
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
});

async function notesRequest(subject: string, method: string, path = "", body?: unknown) {
  const response = await fetch(`${baseUrl}/v1/notes${path}`, {
    method, headers: { authorization: `Bearer ${await token("1h", subject)}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

test("proprietário lê; outro proprietário recebe 404 e não altera a nota", async () => {
  const created = await notesRequest("owner-a", "POST", "", { title: "Privada", body: "segredo" });
  assert.equal(created.status, 201);
  const note = await created.json() as { id: string; version: number; body: string };
  assert.equal((await notesRequest("owner-a", "GET", `/${note.id}`)).status, 200);
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const response = await notesRequest("owner-b", method, `/${note.id}`, method === "PATCH" ? { version: 1, title: "Invasão" } : undefined);
    assert.equal(response.status, 404, method);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "NOT_FOUND");
  }
  const ownerRead = await notesRequest("owner-a", "GET", `/${note.id}`);
  assert.equal(ownerRead.status, 200);
  assert.equal((await ownerRead.json() as { body: string; version: number }).body, "segredo");
  const otherList = await notesRequest("owner-b", "GET");
  assert.deepEqual((await otherList.json() as { items: unknown[] }).items, []);
});

test("notas rejeitam tipo, tamanho, campos extras, query e IDs inválidos", async () => {
  const invalidCreates = [
    { title: 1 }, { title: "" }, { title: "x".repeat(201) },
    { title: "ok", body: 12 }, { title: "ok", body: "x".repeat(100_001) },
    { title: "ok", tags: ["x".repeat(41)] }, { title: "ok", tags: Array(21).fill("x") },
    { title: "ok", ownerId: "owner-b" }, { title: "ok", folderId: "bad-id" },
  ];
  for (const body of invalidCreates) {
    const response = await notesRequest("owner-a", "POST", "", body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await response.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");
  }
  for (const path of ["?limit=0", "?limit=101", "?ownerId=owner-b", "/bad-id"]) {
    assert.equal((await notesRequest("owner-a", "GET", path)).status, 400, path);
  }
  const created = await notesRequest("owner-a", "POST", "", { title: "Válida" });
  const { id: noteId } = await created.json() as { id: string };
  for (const body of [{ version: "1", title: "x" }, { version: 1, title: 4 }, { version: 1, extra: true }, { version: 0, title: "x" }]) {
    assert.equal((await notesRequest("owner-a", "PATCH", `/${noteId}`, body)).status, 400);
  }
});

test("repetir leitura não altera a nota; exclusão repetida retorna 404", async () => {
  const created = await notesRequest("owner-a", "POST", "", { title: "Reenvio" });
  const note = await created.json() as { id: string };
  const first = await (await notesRequest("owner-a", "GET", `/${note.id}`)).json();
  const second = await (await notesRequest("owner-a", "GET", `/${note.id}`)).json();
  assert.deepEqual(second, first);
  assert.equal((await notesRequest("owner-a", "DELETE", `/${note.id}`)).status, 204);
  assert.equal((await notesRequest("owner-a", "DELETE", `/${note.id}`)).status, 404);
});

test.skip("hábitos: sem autenticação, modificação negada sem alterar estado (branch da frente hábitos ainda não integrada)", () => {});
test.skip("Lambda: verificar o handler HTTP com authorizer JWT real do API Gateway (branch Lambda ainda não integrada)", () => {});
test.skip("MCP: prompt injection não concede ferramentas ou dados extras (branch MCP ainda não integrada)", () => {});

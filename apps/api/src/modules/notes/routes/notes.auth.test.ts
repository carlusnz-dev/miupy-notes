import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Router } from "express";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { createApp } from "../../../app.js";
import { ServiceError } from "../../../core/domain/app-error.js";
import { authenticate, bearerTokenClaims, lambdaAuthorizerClaims, parseAllowedSubs, principalFromClaims } from "../../../core/http/authenticate.js";
import { NotesController } from "../controllers/notes.controller.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { NotesServiceImpl } from "../services/notes.service.impl.js";
import { createNotesRouter } from "./notes.routes.js";

// Chaves geradas no teste fazem o papel do JWKS do Google; nenhuma chamada de rede.
const audience = "test-client.apps.googleusercontent.com";
const allowedSubs = parseAllowedSubs("owner-sub, second-sub");
let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let baseUrl = "";
let server: ReturnType<typeof createServer>;

before(async () => {
  const google = await generateKeyPair("RS256");
  foreignKey = (await generateKeyPair("RS256")).privateKey;
  signingKey = google.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(google.publicKey)), kid: "test-key", alg: "RS256" }] });
  const notesRouter = createNotesRouter(new NotesController(new NotesServiceImpl(new MemoryNotesRepository(), { exists: async () => false })));
  server = createServer(createApp({ authenticate: authenticate(bearerTokenClaims(jwks, audience), allowedSubs), notesRouter, foldersRouter: Router() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1/notes`;
});

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type TokenOptions = { sub?: string; iss?: string; aud?: string; exp?: string | number; key?: CryptoKey };

function token(options: TokenOptions = {}) {
  return new SignJWT({ email: "dono@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(options.sub ?? "owner-sub")
    .setIssuer(options.iss ?? "https://accounts.google.com")
    .setAudience(options.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "1h")
    .sign(options.key ?? signingKey);
}

function call(authorization: string | null, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;
  return fetch(baseUrl, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json() as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, code);
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
}

test("sem token responde 401", async () => {
  await expectError(await call(null), 401, "UNAUTHORIZED");
  await expectError(await call("Basic abc"), 401, "UNAUTHORIZED");
});

test("token malformado ou de outra chave responde 401", async () => {
  await expectError(await call("Bearer nao-e-um-jwt"), 401, "UNAUTHORIZED");
  await expectError(await call(`Bearer ${await token({ key: foreignKey })}`), 401, "UNAUTHORIZED");
});

test("token sem assinatura (alg none) responde 401", async () => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "none" })}.${encode({ sub: "owner-sub", iss: "https://accounts.google.com", aud: audience, exp: now + 3600 })}.`;
  await expectError(await call(`Bearer ${unsigned}`), 401, "UNAUTHORIZED");
});

test("token expirado responde 401", async () => {
  await expectError(await call(`Bearer ${await token({ exp: Math.floor(Date.now() / 1000) - 60 })}`), 401, "UNAUTHORIZED");
});

test("aud ou iss errados respondem 401", async () => {
  await expectError(await call(`Bearer ${await token({ aud: "outro-cliente.apps.googleusercontent.com" })}`), 401, "UNAUTHORIZED");
  await expectError(await call(`Bearer ${await token({ iss: "https://evil.example.com" })}`), 401, "UNAUTHORIZED");
});

test("sub fora da lista responde 403", async () => {
  await expectError(await call(`Bearer ${await token({ sub: "intruder-sub" })}`), 403, "FORBIDDEN");
});

test("sub permitido lista e cria notas com ownerId = sub", async () => {
  const owner = `Bearer ${await token()}`;
  const created = await call(owner, { method: "POST", body: { title: "Primeira" } });
  assert.equal(created.status, 201);
  const note = await created.json() as Record<string, unknown>;
  assert.equal("ownerId" in note, false);

  const list = await call(owner);
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json() as { items: Array<{ id: string }> }).items.map((item) => item.id), [note.id]);

  // As duas formas de iss documentadas pelo Google são aceitas; outro sub permitido não vê a nota.
  const other = await call(`Bearer ${await token({ sub: "second-sub", iss: "accounts.google.com" })}`);
  assert.equal(other.status, 200);
  assert.deepEqual((await other.json() as { items: unknown[] }).items, []);
});

test("Lambda lê claims do authorizer e aplica a mesma lista", async () => {
  const request = (claims?: JWTPayload) => ({ requestContext: claims ? { authorizer: { jwt: { claims } } } : {} }) as never;
  assert.deepEqual(principalFromClaims(await lambdaAuthorizerClaims(request({ sub: "owner-sub" })), allowedSubs), { ownerId: "owner-sub" });
  await assert.rejects(lambdaAuthorizerClaims(request()), { status: 401 });
  assert.throws(() => principalFromClaims({ sub: "intruder-sub" }, allowedSubs), { status: 403 });
  assert.throws(() => principalFromClaims({}, allowedSubs), { status: 401 });
});

test("lista vazia de sub nega todos", () => {
  assert.throws(() => principalFromClaims({ sub: "owner-sub" }, parseAllowedSubs(undefined)), { status: 403 });
});

test("falha ao obter as chaves do Google não vira 401 e preserva a causa para o log", async () => {
  const signed = await token();
  const request = { header: () => `Bearer ${signed}` } as never;
  const failures: Array<[string, unknown]> = [
    ["timeout", new errors.JWKSTimeout()],
    ["JWKS inválido", new errors.JWKSInvalid()],
    ["resposta não-200 (JOSEError genérico)", new errors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response")],
    ["rede", new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) })],
  ];
  for (const [label, failure] of failures) {
    const source = bearerTokenClaims(async () => { throw failure; }, audience);
    await assert.rejects(source(request), (error: unknown) => error instanceof ServiceError && error.cause === failure && error.context.service === "Google (chaves do login)", label);
  }
});

test("token inválido continua 401 mesmo com a classe JOSE específica", async () => {
  const source = bearerTokenClaims(async () => { throw new errors.JWKSNoMatchingKey(); }, audience);
  const signed = await token();
  const request = { header: () => `Bearer ${signed}` } as never;
  await assert.rejects(source(request), { status: 401 });
});

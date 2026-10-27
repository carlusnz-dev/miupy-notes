import assert from "node:assert/strict";
import { test } from "node:test";
import { Router } from "express";
import { createApp } from "./app.js";
import { adaptApp, createAllowedSubsLoader, handler } from "./lambda.js";
import { authenticate, lambdaAuthorizerClaims } from "./core/http/authenticate.js";

const context = {};
const event = (path: string, claims?: Record<string, string>) => ({
  version: "2.0",
  routeKey: "$default",
  rawPath: path,
  rawQueryString: "",
  headers: { host: "example.invalid" },
  requestContext: {
    accountId: "synthetic",
    apiId: "synthetic",
    domainName: "example.invalid",
    domainPrefix: "example",
    http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    requestId: "synthetic",
    routeKey: "$default",
    stage: "$default",
    time: "01/Jan/2026:00:00:00 +0000",
    timeEpoch: 0,
    ...(claims ? { authorizer: { jwt: { claims } } } : {}),
  },
  isBase64Encoded: false,
});

test("Lambda falha antes de acessar serviços quando a tabela não foi configurada", async () => {
  const oldTable = process.env.NOTES_TABLE_NAME;
  process.env.NOTES_TABLE_NAME = "";
  try {
    await assert.rejects(handler(event("/health"), context), /NOTES_TABLE_NAME/);
  } finally {
    if (oldTable === undefined) delete process.env.NOTES_TABLE_NAME;
    else process.env.NOTES_TABLE_NAME = oldTable;
  }
});

test("allowlist atualiza após um minuto e falha fechada se o segredo sumir", async () => {
  let clock = 0;
  let secret: string | undefined = "owner";
  let reads = 0;
  const load = createAllowedSubsLoader(async () => { reads++; return secret; }, () => clock);
  assert.equal((await load()).has("owner"), true);
  secret = "other";
  assert.equal((await load()).has("owner"), true);
  assert.equal(reads, 1);
  clock = 60_000;
  assert.equal((await load()).has("other"), true);
  secret = undefined;
  clock = 120_000;
  await assert.rejects(load(), /ALLOWED_SUBS_SECRET_ARN/);
  assert.equal(reads, 3);
});

test("Lambda HTTP API v2 preserva claims e formato de erros", async () => {
  const notes = Router();
  notes.get("/", (_req, res) => res.json({ ownerId: res.locals.principal.ownerId }));
  notes.get("/error", () => { throw new Error("conteúdo privado"); });
  const handler = adaptApp(createApp({ authenticate: authenticate(lambdaAuthorizerClaims, new Set(["owner"])), notesRouter: notes }));
  const invoke = async (path: string, claims?: Record<string, string>) => await handler(event(path, claims), context) as { statusCode: number; body: string };

  const health = await invoke("/health");
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(String(health.body)), { status: "ok" });

  const allowed = await invoke("/v1/notes", { sub: "owner" });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(JSON.parse(String(allowed.body)), { ownerId: "owner" });

  const denied = await invoke("/v1/notes", { sub: "other" });
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(String(denied.body)).error.code, "FORBIDDEN");

  const failed = await invoke("/v1/notes/error", { sub: "owner" });
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.parse(String(failed.body)).error.code, "INTERNAL_ERROR");
  assert.equal(String(failed.body).includes("conteúdo privado"), false);
});

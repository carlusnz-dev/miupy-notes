import assert from "node:assert/strict";
import { test } from "node:test";
import { Router } from "express";
import { createApp } from "./app.js";
import { adaptApp, createAllowedSubsLoader, handler } from "./lambda.js";
import { Logger } from "./core/logging/logger.js";
import { parseAllowedCidrs, sourceIpGuard } from "./core/http/source-ip-guard.js";
import { authenticate, lambdaAuthorizerClaims } from "./core/http/authenticate.js";

const context = {};
const event = (path: string, claims?: Record<string, string>, sourceIp = "127.0.0.1") => ({
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
    http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp, userAgent: "test" },
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

test("Lambda recusa subir sem ALLOWED_CIDRS e registra a causa na inicialização", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NOTES_TABLE_NAME: "synthetic-table", ALLOWED_SUBS_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic" });
  delete process.env.ALLOWED_CIDRS;
  const written: string[] = [];
  const stderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => { written.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    await assert.rejects(handler(event("/health"), context), /ALLOWED_CIDRS/);
    await assert.rejects(handler(event("/health"), context), /ALLOWED_CIDRS/);
  } finally {
    process.stderr.write = stderr;
    for (const key of ["NOTES_TABLE_NAME", "ALLOWED_SUBS_SECRET_ARN", "ALLOWED_CIDRS"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
  const line = written.find((entry) => entry.includes("Falha ao inicializar a Lambda"));
  assert.ok(line);
  assert.match(line, /módulo=lambda \| operação=createHandler \| causa=ConfigurationError\(config=ALLOWED_CIDRS\)/);
  assert.equal(written.filter((entry) => entry.includes("Falha ao inicializar a Lambda")).length, 2, "nova tentativa após falha de inicialização");
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

test("Lambda aplica a allow list de IP antes de /health e das rotas privadas", async () => {
  const lines: Array<Record<string, unknown>> = [];
  const log = new Logger("debug", (line) => { lines.push(JSON.parse(line)); }, { format: "json" });
  const notes = Router();
  notes.get("/", (_req, res) => res.json({ ownerId: res.locals.principal.ownerId }));
  const app = createApp({ sourceGuard: sourceIpGuard(parseAllowedCidrs("203.0.113.0/24"), log), authenticate: authenticate(lambdaAuthorizerClaims, new Set(["owner"])), notesRouter: notes }, log);
  const invoke = async (path: string, sourceIp: string, claims?: Record<string, string>) => await adaptApp(app)(event(path, claims, sourceIp), context) as { statusCode: number; body: string };

  assert.equal((await invoke("/health", "203.0.113.5")).statusCode, 200);
  assert.equal((await invoke("/v1/notes", "203.0.113.5", { sub: "owner" })).statusCode, 200);
  for (const [path, claims] of [["/health", undefined], ["/v1/notes", { sub: "owner" }]] as const) {
    const denied = await invoke(path, "198.51.100.77", claims);
    assert.equal(denied.statusCode, 403);
    assert.equal(JSON.parse(denied.body).error.code, "ORIGIN_NOT_ALLOWED");
  }
  assert.equal(lines.filter((line) => line.event === "request.denied").length, 2);
  assert.doesNotMatch(JSON.stringify(lines), /198\.51\.100\.77|203\.0\.113\.5/);
});

test("falha inesperada registra módulo, operação, causa e frame sem mensagem nem conteúdo", async () => {
  const lines: Array<Record<string, unknown>> = [];
  const log = new Logger("debug", (line) => { lines.push(JSON.parse(line)); }, { format: "json" });
  const notes = Router();
  notes.get("/boom", () => { throw Object.assign(new Error("conteúdo privado", { cause: Object.assign(new Error("token abc"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 400, requestId: "aws-req-1" } }) }), { name: "DependencyFailure" }); });
  const app = createApp({ authenticate: (_req, _res, next) => next(), notesRouter: notes }, log);
  const response = await adaptApp(app)(event("/v1/notes/boom", { sub: "owner" }), context) as { statusCode: number; body: string };
  assert.equal(response.statusCode, 500);
  const failed = lines.find((line) => line.event === "request.failed");
  assert.ok(failed);
  assert.equal(failed.module, "notes");
  assert.equal(failed.operation, "GET /v1/notes/boom");
  assert.equal(failed.dependency, "aws-sdk");
  assert.deepEqual(failed.errorChain, ["DependencyFailure", "AccessDeniedException(providerStatus=400,providerRequestId=aws-req-1)"]);
  assert.ok(Array.isArray(failed.origin) && failed.origin.length > 0);
  assert.doesNotMatch(JSON.stringify(lines), /privado|token abc|\/home\//);
});

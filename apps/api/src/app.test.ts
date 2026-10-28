import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { createApp } from "./app.js";

const server = createServer(createApp());
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

test("health responde sem acessar dados pessoais", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("JSON inválido responde 400 com requestId", async () => {
  const response = await fetch(`${baseUrl}/health`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string; requestId?: string } };
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(typeof body.error.requestId, "string");
});

test("sem autenticação configurada, /v1/notes não é montado", async () => {
  const id = "0b5d6f7e-1c2a-4b3d-8e9f-a0b1c2d3e4f5";
  const requests: Array<[string, string]> = [["GET", "/v1/notes"], ["POST", "/v1/notes"], ["GET", `/v1/notes/${id}`], ["PATCH", `/v1/notes/${id}`], ["DELETE", `/v1/notes/${id}`]];
  for (const [method, path] of requests) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", "x-test-owner": "alice" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
    assert.equal(response.status, 404, `${method} ${path}`);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "NOT_FOUND");
  }
});

test("logs HTTP correlacionam erros e sucesso sem dados pessoais", async () => {
  const { Router } = await import("express");
  const { Logger } = await import("./core/logging/logger.js");
  const { AppError } = await import("./core/domain/app-error.js");
  const lines: string[] = [];
  const log = new Logger("debug", (line) => { lines.push(line); }, { format: "json" });
  const router = Router();
  router.get("/ok/:id", (_req, res) => { res.json({ ok: true }); });
  router.get("/summary", () => { throw new Error("private summary"); });
  router.get("/fail", () => { throw Object.assign(new Error("private@example.com TOKEN"), { cause: Object.assign(new Error("private body"), { code: "ECONNREFUSED" }), config: { secret: "TOKEN" } }); });
  router.get("/missing", () => { throw Object.assign(new Error("private table"), { name: "ResourceNotFoundException" }); });
  router.get("/unknown", () => { throw Object.assign(new Error("private message"), { name: "private@example.com", code: "TOKEN" }); });
  router.get("/reject/:status", (req) => { throw new AppError(Number(req.params.status), "REJECTED", "Rejeitado."); });
  router.get("/deny", () => { throw new AppError(401, "UNAUTHORIZED", "Não autorizado."); });
  router.get("/:id", () => { throw new Error("private id"); });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, log));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const [path, status] of [["/v1/notes/ok/private-id?email=private@example.com", 200], ["/v1/notes/fail", 500], ["/v1/notes/summary?email=private@example.com", 500], ["/v1/notes/00000000-0000-4000-8000-000000000001?token=TOKEN", 500], ["/v1/notes/missing", 500], ["/v1/notes/unknown", 500], ["/v1/notes/deny", 401], ["/v1/notes/reject/403", 403], ["/v1/notes/reject/409", 409], ["/v1/notes/reject/413", 413], ["/private-path", 404]] as const) {
      const response = await fetch(`${url}${path}`, { headers: { Authorization: "Bearer TOKEN", Cookie: "private cookie", "X-Request-Id": "private supplied" } });
      assert.equal(response.status, status);
      const id = response.headers.get("x-request-id");
      assert.match(id!, /^[\da-f-]{36}$/);
      const body = await response.json() as { error?: { requestId: string } };
      if (body.error) assert.equal(body.error.requestId, id);
      const completed = lines.map((line) => JSON.parse(line)).find((entry) => entry.requestId === id && entry.event === "request.completed");
      assert.equal(completed.statusCode, status);
      assert.ok(completed.durationMs >= 0);
      if (status === 200) assert.equal(completed.route, "/v1/notes/ok/:id");
      const failed = lines.map((line) => JSON.parse(line)).find((entry) => entry.requestId === id && entry.event === "request.failed");
      if (status !== 200 && status !== 404) {
        assert.equal(failed.statusCode, status);
        assert.equal(failed.method, "GET");
        assert.equal(failed.route, completed.route);
        assert.ok(failed.route.startsWith("/v1/notes/"));
      }
      if (path.includes("/summary?")) assert.equal(failed.route, "/v1/notes/summary");
      if (path.includes("00000000")) assert.equal(failed.route, "/v1/notes/:id");
    }
    const malformed = await fetch(`${url}/health`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"private":' });
    assert.equal(malformed.status, 400);
    await malformed.json();
    assert.ok(lines.some((line) => line.includes("dependency_unreachable")));
    assert.ok(lines.some((line) => line.includes("dependency_resource_missing")));
    assert.ok(lines.some((line) => line.includes("unknown_error")));
    assert.ok(lines.some((line) => line.includes("request.started")));
    assert.doesNotMatch(lines.join("\n"), /private|TOKEN|Authorization|Cookie|ownerId|00000000-0000-4000-8000-000000000001/);
  } finally { await new Promise<void>((resolve) => local.close(() => resolve())); }
});

test("logs da agenda registram o template /v1/calendar sem UUID, query nem identidade", async () => {
  const { Router } = await import("express");
  const { Logger } = await import("./core/logging/logger.js");
  const { AppError } = await import("./core/domain/app-error.js");
  const lines: string[] = [];
  const log = new Logger("info", (line) => { lines.push(line); }, { format: "json" });
  const router = Router();
  router.get("/events/:id", () => { throw new AppError(404, "NOT_FOUND", "Evento não encontrado."); });
  router.patch("/events/:id", () => { throw new AppError(409, "CONFLICT", "Conflito."); });
  router.get("/google", () => { throw new Error("private google"); });
  router.get("/events", (_req, res) => { res.json({ items: [], nextCursor: null }); });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: Router(), calendarRouter: router }, log));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const secretId = "00000000-0000-4000-8000-0000000000aa";
  try {
    for (const [method, path, status, route] of [
      ["GET", `/v1/calendar/events/${secretId}?from=private@example.com`, 404, "/v1/calendar/events/:id"],
      ["PATCH", `/v1/calendar/events/${secretId}`, 409, "/v1/calendar/events/:id"],
      ["GET", "/v1/calendar/google", 500, "/v1/calendar/google"],
      ["GET", "/v1/calendar/events?cursor=TOKEN", 200, "/v1/calendar/events"],
    ] as const) {
      const response = await fetch(`${url}${path}`, { method, headers: { Authorization: "Bearer TOKEN", "content-type": "application/json" }, body: method === "PATCH" ? "{}" : undefined });
      assert.equal(response.status, status);
      const id = response.headers.get("x-request-id");
      const entries = lines.map((line) => JSON.parse(line)).filter((entry) => entry.requestId === id);
      const completed = entries.find((entry) => entry.event === "request.completed");
      assert.equal(completed.route, route);
      if (status >= 400) assert.equal(entries.find((entry) => entry.event === "request.failed").route, route);
    }
    assert.doesNotMatch(lines.join("\n"), /private|TOKEN|00000000-0000-4000-8000-0000000000aa|alice/);
  } finally { await new Promise<void>((resolve) => local.close(() => resolve())); }
});

test("níveis filtram debug e classificação trata causas cíclicas", async () => {
  const { Logger, classifyError } = await import("./core/logging/logger.js");
  const lines: string[] = [];
  const sink = (line: string) => { lines.push(line); };
  const log = new Logger("invalid", sink, { format: "json" });
  log.debug("request.started"); log.info("request.completed"); log.warn("request.failed"); log.error("request.failed");
  assert.deepEqual(lines.map((line) => JSON.parse(line).level), ["info", "warn", "error"]);
  const error = Object.assign(new Error("secret"), { cause: {} });
  error.cause = error;
  assert.deepEqual(classifyError(error), { classification: "unknown_error", errorTypes: [], service: undefined, operation: undefined, detail: undefined, providerStatus: undefined });
  assert.doesNotThrow(() => new Logger("info", () => { throw new Error("sink unavailable"); }).info("request.completed"));
});

test("conexão interrompida gera um único evento de abort", async () => {
  const { Router } = await import("express");
  const { request } = await import("node:http");
  const { Logger } = await import("./core/logging/logger.js");
  const lines: Array<{ event: string }> = [];
  const router = Router();
  router.get("/slow", (_req, res) => { res.write("partial"); });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, new Logger("info", (line) => { lines.push(JSON.parse(line)); }, { format: "json" })));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address(); assert.ok(address && typeof address !== "string");
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${address.port}/v1/notes/slow`, (res) => { res.once("data", () => { res.destroy(); resolve(); }); });
      req.on("error", reject); req.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lines.filter((line) => line.event === "request.aborted").length, 1);
    assert.equal(lines.filter((line) => line.event === "request.completed").length, 0);
  } finally { local.closeAllConnections(); await new Promise<void>((resolve) => local.close(() => resolve())); }
});

test("erro após headers encerra conexão sem imprimir Error pessoal", async () => {
  const { Router } = await import("express");
  const { request } = await import("node:http");
  const { Logger } = await import("./core/logging/logger.js");
  const output: string[] = [];
  const consoleMock = mock.method(console, "error", (...args: unknown[]) => { output.push(args.join(" ")); });
  const stderrMock = mock.method(process.stderr, "write", (chunk: unknown) => { output.push(String(chunk)); return true; });
  const router = Router();
  router.get("/summary", (_req, res, next) => {
    res.write("partial");
    setTimeout(() => next(Object.assign(new Error("SECRET_MESSAGE"), { cause: new Error("SECRET_CAUSE") })), 10);
  });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, new Logger("debug", (line) => { output.push(line); }, { format: "json" })));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address(); assert.ok(address && typeof address !== "string");
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${address.port}/v1/notes/summary?secret=SECRET_QUERY`, (res) => {
        assert.equal(res.statusCode, 200);
        res.on("aborted", resolve);
        res.on("error", () => {});
        res.resume();
        res.on("end", () => reject(new Error("Resposta deveria ser interrompida.")));
      });
      req.on("error", reject); req.end();
    });
    await new Promise((resolve) => setImmediate(resolve));
    const failed = output.map((line) => JSON.parse(line)).find((line) => line.event === "request.failed");
    assert.equal(failed.route, "/v1/notes/summary");
    assert.equal(failed.method, "GET");
    assert.equal(failed.statusCode, 500);
    assert.equal(output.filter((line) => line.includes('"event":"request.aborted"')).length, 1);
    assert.doesNotMatch(output.join("\n"), /SECRET|Error:|stack|cause/);
  } finally {
    consoleMock.mock.restore(); stderrMock.mock.restore();
    local.closeAllConnections(); await new Promise<void>((resolve) => local.close(() => resolve()));
  }
});

test("sink com falha não interrompe sucesso ou resposta de erro HTTP", async () => {
  const { Router } = await import("express");
  const { Logger } = await import("./core/logging/logger.js");
  const router = Router(); router.get("/summary", () => { throw new Error("SECRET"); });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, new Logger("debug", () => { throw new Error("sink offline"); })));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address(); assert.ok(address && typeof address !== "string");
  try {
    const healthy = await fetch(`http://127.0.0.1:${address.port}/health`); assert.equal(healthy.status, 200); await healthy.json();
    const failed = await fetch(`http://127.0.0.1:${address.port}/v1/notes/summary`); assert.equal(failed.status, 500);
    const body = await failed.json() as { error: { code: string } }; assert.equal(body.error.code, "INTERNAL_ERROR");
  } finally { await new Promise<void>((resolve) => local.close(() => resolve())); }
});

test("handler HTTP legível informa motivo, status e requestId sem expor requisição ou exceção", async () => {
  const { Router } = await import("express");
  const { Logger } = await import("./core/logging/logger.js");
  const lines: string[] = [];
  const router = Router();
  router.get("/:id", () => { throw Object.assign(new Error("PRIVATE_EXCEPTION"), { code: "ECONNREFUSED" }); });
  const log = new Logger("info", line => { lines.push(line); }, { format: "pretty", color: false });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, log));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const ok = await fetch(`${url}/health`); await ok.json();
    const failed = await fetch(`${url}/v1/notes/PRIVATE_ID?token=PRIVATE_TOKEN`);
    const body = await failed.json() as { error: { requestId: string } };
    assert.equal(failed.status, 500);
    const bad = await fetch(`${url}/health`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"PRIVATE_BODY":' });
    assert.equal(bad.status, 400); await bad.json();
    assert.ok(lines.some(line => line.includes("SUCCESS - GET /health Requisição concluída com sucesso.")));
    assert.ok(lines.some(line => line.includes("ERROR - GET /v1/notes/:id Não foi possível conectar") && line.includes(body.error.requestId)));
    assert.ok(lines.some(line => line.includes("WARN - POST [rota não identificada] JSON inválido")));
    assert.doesNotMatch(lines.join("\n"), /PRIVATE|\x1b/);
  } finally { await new Promise<void>((resolve) => local.close(() => resolve())); }
});

test("500 registra operação, serviço, causa original e requestId sem dados sensíveis", async () => {
  const { Router } = await import("express");
  const { Logger } = await import("./core/logging/logger.js");
  const { AppError, ServiceError } = await import("./core/domain/app-error.js");
  const lines: string[] = [];
  const log = new Logger("info", (line) => { lines.push(line); }, { format: "json" });
  const router = Router();
  const network = new TypeError("fetch failed https://oauth.example/token?code=TOKEN", { cause: Object.assign(new Error("connect secret@example.com"), { code: "ECONNREFUSED" }) });
  router.get("/service", () => { throw new ServiceError({ service: "Google (chaves do login)", operation: "validar o ID token" }, network); });
  router.get("/upstream", () => { throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Indisponível.", undefined, { service: "Google Calendar", detail: "unavailable", providerStatus: 503 }, network); });
  router.get("/plain", () => { throw new RangeError("private conteúdo da nota"); });
  const local = createServer(createApp({ authenticate: (_req, _res, next) => next(), notesRouter: router }, log));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const address = local.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const [path, status] of [["/v1/notes/service", 500], ["/v1/notes/upstream", 502], ["/v1/notes/plain", 500]] as const) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, status);
      const id = response.headers.get("x-request-id");
      const failed = lines.map((line) => JSON.parse(line)).find((entry) => entry.requestId === id && entry.event === "request.failed");
      assert.equal(failed.level, "error");
      assert.equal(failed.statusCode, status);
      assert.equal(failed.route, path);
      assert.match(failed.origin[0], /app\.test\.ts:\d+/);
      if (path.endsWith("service")) {
        assert.equal(failed.service, "Google (chaves do login)");
        assert.equal(failed.operation, "validar o ID token");
        assert.deepEqual(failed.errorChain, ["ServiceError", "TypeError", "Error(code=ECONNREFUSED)"]);
        assert.match(failed.message, /^Falha em Google \(chaves do login\) ao validar o ID token\.$/);
      }
      if (path.endsWith("upstream")) assert.deepEqual([failed.service, failed.detail, failed.providerStatus], ["Google Calendar", "unavailable", 503]);
      if (path.endsWith("plain")) assert.deepEqual(failed.errorChain, ["RangeError"]);
    }
    assert.doesNotMatch(lines.join("\n"), /TOKEN|secret@|private|oauth\.example|conteúdo/);
  } finally { await new Promise<void>((resolve) => local.close(() => resolve())); }
});

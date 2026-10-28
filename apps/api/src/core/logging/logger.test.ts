import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceError } from "../domain/app-error.js";
import { classifyError, describeError, Logger, type LogLevel } from "./logger.js";

function capture(color = false) {
  const lines: string[] = [];
  const levels: LogLevel[] = [];
  const log = new Logger("debug", (line, level) => { lines.push(line); levels.push(level); }, { format: "pretty", color });
  return { log, lines, levels };
}

test("request legível traz horário UTC, resultado, rota template e correlação", () => {
  const { log, lines, levels } = capture();
  log.info("request.completed", { method: "PATCH", route: "/v1/notes/:id", statusCode: 200, durationMs: 12.5, requestId: "test-request" });
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z SUCCESS - PATCH \/v1\/notes\/:id Requisição concluída com sucesso\. \[HTTP 200 \| 12\.5 ms \| requestId=test-request\]$/);
  assert.deepEqual(levels, ["success"]);
  assert.doesNotMatch(lines[0], /\x1b/);
});

test("falhas trazem motivo seguro, sem conteúdo de Error ou campos extras", () => {
  const { log, lines } = capture();
  log.error("request.failed", { method: "GET", route: "/v1/notes/summary", statusCode: 500, classification: "dependency_unreachable", errorTypes: ["ECONNREFUSED"], ...{ message: "SECRET", body: "PRIVATE", cause: new Error("TOKEN") } });
  log.warn("request.failed", { method: "POST", route: "unmatched", statusCode: 400, reason: "invalid_json" });
  assert.match(lines[0], /ERROR - GET \/v1\/notes\/summary Não foi possível conectar ao serviço de dados/);
  assert.match(lines[0], /ECONNREFUSED/);
  assert.match(lines[1], /WARN - POST \[rota não identificada\] JSON inválido no corpo/);
  assert.doesNotMatch(lines.join("\n"), /SECRET|PRIVATE|TOKEN|cause|stack/);
});

test("respostas 4xx/5xx e abort não são anunciados como sucesso e respeitam filtro", () => {
  const { log, lines, levels } = capture();
  log.info("request.completed", { statusCode: 409 });
  log.info("request.completed", { statusCode: 500 });
  log.info("request.aborted");
  assert.deepEqual(levels, ["warn", "error", "warn"]);
  assert.match(lines[0], /Conflito de versão/);
  assert.match(lines[1], /Falha interna/);
  assert.match(lines[2], /Conexão interrompida/);
  const filtered: string[] = [];
  const errors = new Logger("error", line => { filtered.push(line); }, { format: "pretty", color: false });
  errors.info("request.completed", { statusCode: 200 });
  errors.info("request.completed", { statusCode: 500 });
  assert.equal(filtered.length, 1);
});

test("eventos do sistema têm mensagem sem segmento de requisição", () => {
  const { log, lines } = capture();
  log.info("server.listening", { port: 4000 });
  log.info("dependencies.configured", { dependency: "dynamodb-local" });
  assert.match(lines[0], /Z INFO - Servidor pronto na porta 4000\.$/);
  assert.match(lines[1], /Z INFO - DynamoDB Local configurado; conexão ainda não verificada\.$/);
  assert.doesNotMatch(lines.join("\n"), /OTHER|rota|HTTP|requestId/);
});

test("cores distinguem sucesso, aviso e erro; NO_COLOR desliga a detecção automática", () => {
  const { log, lines } = capture(true);
  log.success("request.completed");
  log.warn("request.failed");
  log.error("request.failed");
  assert.match(lines[0], /\x1b\[32mSUCCESS\x1b\[0m/);
  assert.match(lines[1], /\x1b\[33mWARN\x1b\[0m/);
  assert.match(lines[2], /\x1b\[31mERROR\x1b\[0m/);
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const noColor = process.env.NO_COLOR;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  process.env.NO_COLOR = "1";
  try {
    const plain: string[] = [];
    new Logger("info", line => { plain.push(line); }, { format: "pretty" }).info("server.listening", { port: 4000 });
    assert.doesNotMatch(plain[0], /\x1b/);
  } finally {
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
  }
});

test("JSON opcional mantém metadados, acrescenta mensagem e não contém ANSI", () => {
  const lines: string[] = [];
  new Logger("info", line => { lines.push(line); }, { format: "json", color: true }).info("request.completed", { method: "GET", route: "/health", statusCode: 200 });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "success");
  assert.equal(entry.event, "request.completed");
  assert.equal(entry.message, "Requisição concluída com sucesso.");
  assert.equal(entry.route, "/health");
  assert.doesNotMatch(lines[0], /\x1b/);
});

test("falha de serviço traz serviço, operação, status e causa; texto livre é filtrado", () => {
  const { log, lines } = capture();
  log.error("request.failed", { method: "GET", route: "/v1/habits/occurrences", statusCode: 500, requestId: "r1", service: "Google Calendar", operation: "sincronizar", detail: "unavailable", providerStatus: 503, errorChain: ["TypeError", "Error(code=ECONNREFUSED)"], origin: ["x.ts:12"], ...{ message: "SECRET" } });
  log.error("request.failed", { statusCode: 500, service: "x\nTOKEN=abc123 <script>", providerStatus: 99999 });
  assert.match(lines[0], /ERROR - GET \/v1\/habits\/occurrences Falha em Google Calendar ao sincronizar\. \[HTTP 500 \| requestId=r1 \| operação=sincronizar \| serviço=Google Calendar \| detalhe=unavailable \| provedor=HTTP 503 \| causa=TypeError <- Error\(code=ECONNREFUSED\) \| em=x\.ts:12\]$/);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join("\n"), /SECRET|<script|=abc|99999/);
  const json: string[] = [];
  new Logger("info", line => { json.push(line); }, { format: "json" }).error("request.failed", { statusCode: 500, service: "Google Calendar", errorChain: ["Error"] });
  assert.deepEqual([JSON.parse(json[0]).service, JSON.parse(json[0]).errorChain], ["Google Calendar", ["Error"]]);
});

test("classifyError extrai contexto, causas e origem sem mensagens", () => {
  const root = Object.assign(new Error("private body"), { code: "ECONNREFUSED" });
  const wrapped = new ServiceError({ service: "Google (chaves do login)", operation: "validar o ID token" }, new TypeError("private token", { cause: root }));
  const info = classifyError(wrapped);
  const cause = describeError(wrapped);
  assert.deepEqual([info.service, info.operation, cause.errorChain], ["Google (chaves do login)", "validar o ID token", ["ServiceError", "TypeError", "Error(code=ECONNREFUSED)"]]);
  assert.match(cause.origin![0], /logger\.test\.ts:\d+/);
  assert.doesNotMatch(JSON.stringify([info, cause]), /private/);
  const aws = classifyError(Object.assign(new Error("private"), { name: "ThrottlingException", $metadata: { httpStatusCode: 400 } }));
  assert.deepEqual([aws.service, aws.providerStatus, describeError(Object.assign(new Error("private"), { name: "ThrottlingException", $metadata: { httpStatusCode: 400 } })).errorChain], ["DynamoDB", 400, ["ThrottlingException(providerStatus=400)"]]);
});

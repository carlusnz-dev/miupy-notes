import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { ConfigurationError } from "../domain/app-error.js";
import { Logger } from "../logging/logger.js";
import { requestLogger } from "./request-logger.js";
import { maskIp, parseAllowedCidrs, sourceIpGuard } from "./source-ip-guard.js";

test("CIDRs IPv4 e IPv6 são casados, inclusive IPv4 mapeado em IPv6", () => {
  const list = parseAllowedCidrs(" 203.0.113.0/24, 198.51.100.7 ,2001:db8::/32 ");
  assert.equal(list.check("203.0.113.200", "ipv4"), true);
  assert.equal(list.check("198.51.100.7", "ipv4"), true);
  assert.equal(list.check("198.51.100.8", "ipv4"), false);
  assert.equal(list.check("2001:db8:ffff::1", "ipv6"), true);
  assert.equal(list.check("2001:db9::1", "ipv6"), false);
  assert.equal(list.check("::ffff:203.0.113.9", "ipv6"), true);
});

test("lista vazia, entrada inválida e prefixo /0 falham a inicialização sem vazar o valor", () => {
  for (const value of [undefined, "", " , ", "0.0.0.0/0", "::/0", "203.0.113.0/33", "2001:db8::/129", "203.0.113.0/abc", "300.1.1.1", "nao-e-ip", "1.2.3.4/24/1"]) {
    assert.throws(() => parseAllowedCidrs(value), (error) => error instanceof ConfigurationError && error.setting === "ALLOWED_CIDRS" && !/\d+\.\d+\.\d+\.\d+|nao-e-ip/.test(error.message), String(value));
  }
});

test("máscara preserva só a rede", () => {
  assert.equal(maskIp("203.0.113.9"), "203.0.*.*");
  assert.equal(maskIp("2001:db8:1234::1"), "2001:db8:*");
});

async function call(sourceIp: unknown, headers: Record<string, string> = {}) {
  const lines: Array<Record<string, unknown>> = [];
  const log = new Logger("debug", (line) => { lines.push(JSON.parse(line)); }, { format: "json" });
  const app = express();
  app.use(requestLogger(log));
  app.use((req, _res, next) => { (req as { requestContext?: unknown }).requestContext = sourceIp === "absent" ? {} : { http: { sourceIp } }; next(); });
  app.use(sourceIpGuard(parseAllowedCidrs("203.0.113.0/24,2001:db8::/32"), log));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/health`, { headers });
    return { status: response.status, body: await response.json() as { error?: { code: string; requestId: string } }, lines };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("IP permitido segue; X-Forwarded-For forjado não substitui o IP do gateway", async () => {
  assert.equal((await call("203.0.113.9")).status, 200);
  assert.equal((await call("2001:db8::5")).status, 200);
  const spoofed = await call("198.51.100.9", { "x-forwarded-for": "203.0.113.9" });
  assert.equal(spoofed.status, 403);
});

test("IP fora da lista, ausente ou inválido recebe 403 e log descritivo com IP mascarado", async () => {
  const denied = await call("198.51.100.77");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error?.code, "ORIGIN_NOT_ALLOWED");
  const entry = denied.lines.find((line) => line.event === "request.denied");
  assert.ok(entry);
  assert.deepEqual({ level: entry.level, reason: entry.reason, source: entry.source, module: entry.module, operation: entry.operation, route: entry.route, requestId: entry.requestId === denied.body.error?.requestId }, { level: "warn", reason: "source_ip_not_allowed", source: "198.51.*.*", module: "source-ip-guard", operation: "check ALLOWED_CIDRS", route: "unmatched", requestId: true });
  assert.match(String(entry.message), /ALLOWED_CIDRS/);
  assert.doesNotMatch(JSON.stringify(denied.lines), /198\.51\.100\.77/);
  for (const sourceIp of ["absent", "lixo", 42]) {
    const result = await call(sourceIp);
    assert.equal(result.status, 403);
    const invalid = result.lines.find((line) => line.event === "request.denied");
    assert.equal(invalid?.reason, "source_ip_invalid");
    assert.equal(invalid?.source, undefined);
    assert.doesNotMatch(JSON.stringify(result.lines), /lixo/);
  }
});

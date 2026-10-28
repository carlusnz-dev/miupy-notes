import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Policy = Record<string, string>;
const config = JSON.parse(readFileSync(new URL("../../../../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { app: { security: { csp: Policy; devCsp: Policy } } };

const sources = (policy: Policy, directive: string) => (policy[directive] ?? "").split(/\s+/).filter(Boolean);

test("CSP de produção só abre conexão remota por HTTPS, sem loopback nem WebSocket", () => {
  const connect = sources(config.app.security.csp, "connect-src");
  assert.ok(connect.includes("https:"));
  assert.deepEqual(connect.filter((source) => /^(https?|wss?):/.test(source) && source !== "https:" && source !== "http://ipc.localhost"), []);
  assert.ok(!connect.includes("*") && !connect.includes("http:"));
});

test("CSP de desenvolvimento só acrescenta loopback ao connect-src", () => {
  const extras = sources(config.app.security.devCsp, "connect-src").filter((source) => !sources(config.app.security.csp, "connect-src").includes(source));
  assert.deepEqual(extras.sort(), ["http://127.0.0.1:*", "http://localhost:*", "ws://127.0.0.1:*", "ws://localhost:*"]);
});

test("CSP bloqueia objetos, base alternativa e enquadramento", () => {
  for (const policy of [config.app.security.csp, config.app.security.devCsp]) {
    assert.deepEqual(sources(policy, "object-src"), ["'none'"]);
    assert.deepEqual(sources(policy, "frame-ancestors"), ["'none'"]);
    assert.deepEqual(sources(policy, "default-src"), ["'self'"]);
  }
  assert.ok(!sources(config.app.security.csp, "script-src").includes("'unsafe-inline'"));
});

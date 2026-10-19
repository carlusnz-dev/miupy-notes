import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
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

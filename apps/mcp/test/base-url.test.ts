import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeBaseUrl } from "../src/api-client.js";

test("URL da API: aceita HTTPS remoto e loopback HTTP, recusa HTTP remoto", () => {
  assert.equal(assertSafeBaseUrl("https://abc123.execute-api.us-east-1.amazonaws.com").protocol, "https:");
  assert.equal(assertSafeBaseUrl("http://127.0.0.1:4000").hostname, "127.0.0.1");
  assert.throws(() => assertSafeBaseUrl("http://api.exemplo.com"), /HTTPS/);
});

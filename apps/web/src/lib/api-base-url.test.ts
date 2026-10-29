import assert from "node:assert/strict";
import { test } from "node:test";
import { apiBaseUrlSchema, apiEnvSchema } from "./api-base-url";

test("aceita HTTPS remoto e HTTP somente em loopback", () => {
  for (const url of ["https://abc123.execute-api.sa-east-1.amazonaws.com", "http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
    assert.equal(apiBaseUrlSchema.safeParse(url).success, true, url);
  }
});

test("recusa HTTP remoto, hosts que apenas imitam loopback e esquemas inesperados", () => {
  for (const url of ["http://abc123.execute-api.sa-east-1.amazonaws.com", "http://localhost.evil.example", "http://localhost@evil.example", "http://127.0.0.1.evil.example", "ftp://localhost", "ws://localhost:4000"]) {
    assert.equal(apiBaseUrlSchema.safeParse(url).success, false, url);
  }
});

test("trata VITE_API_BASE_URL vazia como ausente e mantém a recusa de HTTP remoto", () => {
  assert.equal(apiEnvSchema.parse({ VITE_API_BASE_URL: "" }).VITE_API_BASE_URL, undefined);
  assert.equal(apiEnvSchema.parse({}).VITE_API_BASE_URL, undefined);
  assert.equal(apiEnvSchema.safeParse({ VITE_API_BASE_URL: "http://abc123.execute-api.sa-east-1.amazonaws.com" }).success, false);
});

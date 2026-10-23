import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginCredentialStore } from "./login-credential.store.js";

test("lê só a entrada do login pelos atributos do Tauri, sem escrever, apagar nem expor o segredo em argv", async () => {
  const calls: string[][] = [];
  const store = new LoginCredentialStore(async (args) => { calls.push(args); return { code: 0, output: "synthetic-refresh\n" }; });
  assert.equal(await store.get("alice"), "synthetic-refresh");
  assert.deepEqual(calls, [["lookup", "service", "com.miupy.notes", "username", "google-refresh-token"]]);
  assert.equal("put" in store || "delete" in store, false);
  assert.equal(JSON.stringify(calls).includes("synthetic-refresh"), false);
});

test("sem entrada no chaveiro (sem login) devolve null", async () => {
  assert.equal(await new LoginCredentialStore(async () => ({ code: 1, output: "" })).get("alice"), null);
});

test("falhas do executável/cofre viram 503 sem expor a mensagem original", async () => {
  for (const run of [async () => { throw new Error("synthetic-secret"); }, async () => ({ code: 2, output: "synthetic-secret" })]) {
    await assert.rejects(new LoginCredentialStore(run).get("alice"), (error: Error & { code?: string; status?: number }) => error.code === "CREDENTIAL_STORE_UNAVAILABLE" && error.status === 503 && !error.message.includes("synthetic-secret"));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { SecretServiceCredentialStore } from "./secret-service-credential.store.js";
import { createLocalGoogleIntegration } from "./local-google.js";

test("cofre isola proprietário, guarda segredo só no stdin e não toca o cofre de login", async () => {
  const values = new Map<string, string>();
  const calls: string[][] = [];
  const store = new SecretServiceCredentialStore(async (args, input) => {
    calls.push(args);
    const owner = args.at(-1)!;
    if (args[0] === "store") { values.set(owner, input!); return { code: 0, output: "" }; }
    if (args[0] === "clear") { values.delete(owner); return { code: 0, output: "" }; }
    return values.has(owner) ? { code: 0, output: values.get(owner)! + "\n" } : { code: 1, output: "" };
  });
  await store.put("alice", "synthetic-refresh-a"); await store.put("bob", "synthetic-refresh-b");
  assert.equal(await store.get("alice"), "synthetic-refresh-a");
  await store.delete("alice");
  assert.equal(await store.get("alice"), null); assert.equal(await store.get("bob"), "synthetic-refresh-b");
  assert.equal(JSON.stringify(calls).includes("synthetic-refresh"), false);
  assert.equal(JSON.stringify(calls).includes("alice"), false);
  assert.ok(calls.every((args) => args.includes("com.miupy.notes.calendar")));
});

test("falhas do executável/cofre viram 503 sem expor a mensagem original", async () => {
  for (const run of [async () => { throw new Error("synthetic-secret"); }, async () => ({ code: 2, output: "synthetic-secret" })]) {
    const store = new SecretServiceCredentialStore(run);
    for (const action of [() => store.get("alice"), () => store.put("alice", "r"), () => store.delete("alice")]) {
      await assert.rejects(action(), (error: Error & { code?: string; status?: number }) => error.code === "CREDENTIAL_STORE_UNAVAILABLE" && error.status === 503 && !error.message.includes("synthetic-secret"));
    }
  }
});

test("composição local é opt-in e configuração incompleta falha fechada", () => {
  assert.equal(createLocalGoogleIntegration({}), null);
  assert.throws(() => createLocalGoogleIntegration({ GOOGLE_CALENDAR_CLIENT_ID: "synthetic" }));
  assert.throws(() => createLocalGoogleIntegration({ GOOGLE_CALENDAR_CREDENTIAL_STORE: "memory", GOOGLE_CALENDAR_CLIENT_ID: "synthetic" }));
  assert.ok(createLocalGoogleIntegration({ GOOGLE_CALENDAR_CREDENTIAL_STORE: "secret-service", GOOGLE_CALENDAR_CLIENT_ID: "synthetic" }));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalGoogleIntegration } from "./local-google.js";
import { MemoryCredentialStore, SCOPE_MIRROR } from "./google-oauth.js";

const login = { GOOGLE_CLIENT_ID: "login-client", GOOGLE_CLIENT_SECRET: "login-secret" };
const optIn = { GOOGLE_CALENDAR_CREDENTIAL_STORE: "login-keyring" };
const idToken = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

test("sem configuração Calendar explícita, login configurado não habilita o conector", () => {
  assert.equal(createLocalGoogleIntegration({}), null);
  assert.equal(createLocalGoogleIntegration(login), null);
});

const valid: Array<{ name: string; env: Record<string, string>; clientId: string; secret: string }> = [
  { name: "opt-in usa o par do login", env: { ...login, ...optIn }, clientId: "login-client", secret: "login-secret" },
  { name: "Desktop público (sem segredo) é aceito", env: { ...optIn, GOOGLE_CLIENT_ID: "login-client" }, clientId: "login-client", secret: "" },
  { name: "normaliza espaços do par do login e do opt-in", env: { GOOGLE_CLIENT_ID: " login-client ", GOOGLE_CLIENT_SECRET: " login-secret ", GOOGLE_CALENDAR_CREDENTIAL_STORE: " login-keyring " }, clientId: "login-client", secret: "login-secret" },
];

for (const { name, env, clientId, secret } of valid) {
  test(name, async (t) => {
    const forms: URLSearchParams[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      forms.push(new URLSearchParams(init.body as URLSearchParams));
      return Response.json({ scope: `openid ${SCOPE_MIRROR}`, access_token: "synthetic-access", id_token: idToken("alice") });
    });
    const credentials = new MemoryCredentialStore();
    await credentials.put("alice", "synthetic-refresh");
    const deps = createLocalGoogleIntegration(env, credentials);
    assert.ok(deps);
    assert.equal(await deps.tokens.get("alice"), "synthetic-access");
    assert.deepEqual(forms.map((form) => Object.fromEntries(form)), [
      { client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: "synthetic-refresh" },
    ]);
  });
}

test("configuração parcial, cofre antigo ou variáveis Calendar legadas falham sem revelar valores", () => {
  const invalid = [
    { GOOGLE_CALENDAR_CLIENT_ID: "private-client-value" },
    { GOOGLE_CALENDAR_CLIENT_SECRET: "private-secret-value" },
    { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: "private-client-value" },
    { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_SECRET: "" },
    { ...optIn },
    { ...optIn, GOOGLE_CLIENT_ID: " \t " },
    { ...login, GOOGLE_CALENDAR_CREDENTIAL_STORE: "secret-service" },
    { ...login, GOOGLE_CALENDAR_CREDENTIAL_STORE: "private-store-value" },
    { ...login, GOOGLE_CALENDAR_CREDENTIAL_STORE: " \t " },
    { GOOGLE_CALENDAR_CREDENTIAL_STORE: "" },
  ];
  for (const env of invalid) {
    assert.throws(() => createLocalGoogleIntegration(env), (error: Error) => error.message.startsWith("Configure GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring") && !error.message.includes("private-"));
  }
});

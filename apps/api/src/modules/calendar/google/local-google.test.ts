import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalGoogleIntegration } from "./local-google.js";
import { SCOPE_MIRROR, SCOPE_REFLECT } from "./google-oauth.js";

const login = { GOOGLE_CLIENT_ID: "login-client", GOOGLE_CLIENT_SECRET: "login-secret" };
const optIn = { GOOGLE_CALENDAR_CREDENTIAL_STORE: "secret-service" };
const redirectUri = "http://127.0.0.1:53682/callback";

test("sem configuração Calendar explícita, login configurado não habilita o conector", () => {
  assert.equal(createLocalGoogleIntegration({}), null);
  assert.equal(createLocalGoogleIntegration(login), null);
});

const valid: Array<{ name: string; env: Record<string, string>; clientId: string; secret: string }> = [
  { name: "opt-in herda o par do login", env: { ...login, ...optIn }, clientId: "login-client", secret: "login-secret" },
  { name: "ID explícito igual herda segredo do login", env: { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: " login-client " }, clientId: "login-client", secret: "login-secret" },
  { name: "par Calendar sobrescreve o par do login", env: { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: "calendar-client", GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret" }, clientId: "calendar-client", secret: "calendar-secret" },
  { name: "ID diferente nunca herda segredo do login", env: { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: "calendar-client" }, clientId: "calendar-client", secret: "" },
  { name: "Desktop público herdado aceita segredo ausente", env: { ...optIn, GOOGLE_CLIENT_ID: "login-client" }, clientId: "login-client", secret: "" },
  { name: "Desktop público próprio aceita segredo ausente", env: { ...optIn, GOOGLE_CALENDAR_CLIENT_ID: "calendar-client" }, clientId: "calendar-client", secret: "" },
  { name: "segredo Calendar explícito substitui o herdado", env: { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret" }, clientId: "login-client", secret: "calendar-secret" },
  { name: "segredo vazio explícito permite Desktop público sem fallback", env: { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_SECRET: " \t " }, clientId: "login-client", secret: "" },
  { name: "normaliza espaços do par herdado e opt-in", env: { GOOGLE_CLIENT_ID: " login-client ", GOOGLE_CLIENT_SECRET: " login-secret ", GOOGLE_CALENDAR_CREDENTIAL_STORE: " secret-service " }, clientId: "login-client", secret: "login-secret" },
];

for (const { name, env, clientId, secret } of valid) {
  test(name, async (t) => {
    const forms: URLSearchParams[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
      forms.push(new URLSearchParams(init.body as URLSearchParams));
      return Response.json({ refresh_token: "synthetic-refresh", scope: SCOPE_MIRROR, access_token: "synthetic-access" });
    });
    const deps = createLocalGoogleIntegration(env);
    assert.ok(deps);
    for (const scope of [SCOPE_MIRROR, SCOPE_REFLECT]) {
      const url: URL = new URL(deps.oauth.authorizationUrl({ state: "synthetic-state", codeChallenge: "a".repeat(43), redirectUri, scopes: [scope] }));
      assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope,
        state: "synthetic-state", code_challenge: "a".repeat(43), code_challenge_method: "S256",
        access_type: "offline", prompt: "consent", include_granted_scopes: "false",
      });
      assert.equal(url.href.includes("secret"), false);
    }
    assert.deepEqual(await deps.oauth.exchangeCode({ code: "synthetic-code", codeVerifier: "b".repeat(43), redirectUri }), { refreshToken: "synthetic-refresh", scopes: [SCOPE_MIRROR] });
    await deps.oauth.refreshAccessToken("synthetic-refresh");
    assert.deepEqual(forms.map((form) => Object.fromEntries(form)), [
      { client_id: clientId, client_secret: secret, grant_type: "authorization_code", code: "synthetic-code", code_verifier: "b".repeat(43), redirect_uri: redirectUri },
      { client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: "synthetic-refresh" },
    ]);
  });
}

test("configuração Calendar parcial ou vazia falha sem revelar valores", () => {
  const invalid = [
    { GOOGLE_CALENDAR_CLIENT_ID: "private-client-value" },
    { GOOGLE_CALENDAR_CLIENT_SECRET: "private-secret-value" },
    { ...login, GOOGLE_CALENDAR_CLIENT_SECRET: "private-secret-value" },
    { ...optIn },
    { ...optIn, GOOGLE_CLIENT_ID: " \t " },
    { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: " \t " },
    { ...login, ...optIn, GOOGLE_CALENDAR_CLIENT_ID: "" },
    { ...login, GOOGLE_CALENDAR_CREDENTIAL_STORE: "private-store-value" },
    { ...login, GOOGLE_CALENDAR_CREDENTIAL_STORE: " \t " },
    { ...login, GOOGLE_CALENDAR_CLIENT_ID: "" },
    { GOOGLE_CALENDAR_CLIENT_SECRET: "" },
    { GOOGLE_CALENDAR_CREDENTIAL_STORE: "" },
  ];
  for (const env of invalid) {
    assert.throws(() => createLocalGoogleIntegration(env), {
      message: "Configure GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service e GOOGLE_CALENDAR_CLIENT_ID ou GOOGLE_CLIENT_ID na API local.",
    });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleApiError } from "./google-calendar.client.js";
import { HttpGoogleCalendarClient } from "./http-google-calendar.client.js";
import { AccessTokenSource, HttpGoogleOAuth, MemoryCredentialStore, GoogleOAuth, type AccessToken, type TokenGrant } from "./google-oauth.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

class CountingOAuth extends GoogleOAuth {
  refreshes = 0;
  authorizationUrl(): string { return ""; }
  async exchangeCode(): Promise<TokenGrant> { throw new Error("não usado"); }
  async refreshAccessToken(): Promise<AccessToken> { this.refreshes++; return { accessToken: `token-${this.refreshes}`, expiresInSec: 3600 }; }
  async revoke() {}
}

function setup(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const oauth = new CountingOAuth();
  const credentials = new MemoryCredentialStore();
  const tokens = new AccessTokenSource(oauth, credentials);
  const queue = [...responses];
  const client = new HttpGoogleCalendarClient({
    tokens, random: () => 0,
    sleep: async (ms) => { sleeps.push(ms); },
    doFetch: async (url, init) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body as string | undefined });
      const next = queue.shift();
      if (!next) throw new Error("resposta não programada");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, calls, sleeps, oauth, credentials };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const rateLimited = () => json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } });
const event = { id: "e1", etag: "\"1\"" };

async function ready() {
  return (responses: Array<Response | Error>) => { const s = setup(responses); return s.credentials.put("alice", "refresh").then(() => s); };
}

test("incremental envia syncToken e pageToken sem timeMin; completa usa timeMin; sempre singleEvents", async () => {
  const make = await ready();
  const incremental = await make([json(200, { items: [], nextSyncToken: "n" })]);
  await incremental.client.listEvents("alice", "primary", { syncToken: "s1", pageToken: "p2", timeMin: "2026-01-01T00:00:00Z" });
  const url = new URL(incremental.calls[0].url);
  assert.equal(url.searchParams.get("syncToken"), "s1");
  assert.equal(url.searchParams.get("pageToken"), "p2");
  assert.equal(url.searchParams.get("timeMin"), null);
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(incremental.calls[0].headers.authorization, "Bearer token-1");

  const full = await make([json(200, { items: [], nextSyncToken: "n" })]);
  await full.client.listEvents("alice", "primary", { timeMin: "2026-01-01T00:00:00Z" });
  assert.equal(new URL(full.calls[0].url).searchParams.get("timeMin"), "2026-01-01T00:00:00Z");
  assert.equal(new URL(full.calls[0].url).searchParams.get("syncToken"), null);
});

test("429 e 403 rateLimitExceeded repetem com backoff exponencial e respeitam Retry-After", async () => {
  const make = await ready();
  const s = await make([json(429, {}), rateLimited(), json(429, {}, { "retry-after": "3" }), json(200, { items: [] })]);
  const page = await s.client.listEvents("alice", "primary", {});
  assert.deepEqual(page.items, []);
  assert.deepEqual(s.sleeps, [500, 1000, 3000]);
  assert.equal(s.calls.length, 4);
});

test("esgotadas as tentativas o erro é rate_limited; 5xx vira unavailable; erro de rede também", async () => {
  const make = await ready();
  const limited = await make([json(429, {}), json(429, {}), json(429, {}), json(429, {})]);
  await assert.rejects(limited.client.listEvents("alice", "primary", {}), (error) => error instanceof GoogleApiError && error.kind === "rate_limited");
  assert.equal(limited.calls.length, 4);
  const down = await make([json(503, {}), json(503, {}), json(503, {}), json(503, {})]);
  await assert.rejects(down.client.listEvents("alice", "primary", {}), (error) => error instanceof GoogleApiError && error.kind === "unavailable");
  const net = await make([new Error("rede"), new Error("rede"), new Error("rede"), new Error("rede")]);
  await assert.rejects(net.client.listEvents("alice", "primary", {}), (error) => error instanceof GoogleApiError && error.kind === "unavailable");
});

test("410 vira gone, 412 precondition_failed, 409 conflict e 404 not_found, sem repetir", async () => {
  const make = await ready();
  for (const [status, kind] of [[410, "gone"], [412, "precondition_failed"], [409, "conflict"], [404, "not_found"], [400, "invalid"]] as const) {
    const s = await make([json(status, { error: { errors: [{ reason: "x" }] } })]);
    await assert.rejects(s.client.listEvents("alice", "primary", {}), (error) => error instanceof GoogleApiError && error.kind === kind, `${status}`);
    assert.equal(s.calls.length, 1);
  }
});

test("atualizar e excluir enviam If-Match com o ETag; 412 chega como precondition_failed", async () => {
  const make = await ready();
  const ok = await make([json(200, event)]);
  await ok.client.updateEvent("alice", "primary", "e1", { id: "e1", summary: "x" }, "\"7\"");
  assert.equal(ok.calls[0].method, "PUT");
  assert.equal(ok.calls[0].headers["if-match"], "\"7\"");
  assert.equal(new URL(ok.calls[0].url).searchParams.get("sendUpdates"), "none");
  const removed = await make([new Response(null, { status: 204 })]);
  await removed.client.deleteEvent("alice", "primary", "e1", "\"7\"");
  assert.equal(removed.calls[0].headers["if-match"], "\"7\"");
  const stale = await make([json(412, {})]);
  await assert.rejects(stale.client.deleteEvent("alice", "primary", "e1", "\"1\""), { kind: "precondition_failed" });
});

test("401 renova o access token uma vez; segundo 401 exige reautorizar", async () => {
  const make = await ready();
  const s = await make([json(401, {}), json(200, { items: [] })]);
  await s.client.listEvents("alice", "primary", {});
  assert.deepEqual(s.calls.map((call) => call.headers.authorization), ["Bearer token-1", "Bearer token-2"]);
  const dead = await make([json(401, {}), json(401, {})]);
  await assert.rejects(dead.client.listEvents("alice", "primary", {}), { kind: "unauthorized" });
});

test("sem refresh token no cofre nenhuma requisição à Calendar API sai", async () => {
  const s = setup([json(200, { items: [] })]);
  await assert.rejects(s.client.listEvents("alice", "primary", {}), { kind: "unauthorized" });
  assert.equal(s.calls.length, 0);
});

test("erros do provedor não carregam corpo nem token na mensagem", async () => {
  const make = await ready();
  const s = await make([json(400, { error: { message: "segredo-no-corpo" } })]);
  await assert.rejects(s.client.listEvents("alice", "primary", {}), (error: Error) => !error.message.includes("segredo") && !error.message.includes("token"));
});

test("token OAuth: URL de consentimento separada do login e troca de código com PKCE e segredo no servidor", async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const oauth = new HttpGoogleOAuth({ clientId: "cid", clientSecret: "csecret" }, async (url, init) => {
    seen.push({ url, body: String(init.body) });
    return json(200, { refresh_token: "r", scope: "https://www.googleapis.com/auth/calendar.events.owned.readonly", access_token: "a", expires_in: 10 });
  });
  const url = new URL(oauth.authorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "http://127.0.0.1:1/cb", scopes: ["https://www.googleapis.com/auth/calendar.events.owned.readonly"] }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("scope")?.includes("openid"), false);
  assert.equal(url.href.includes("csecret"), false);
  const grant = await oauth.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "http://127.0.0.1:1/cb" });
  assert.equal(grant.refreshToken, "r");
  const form = new URLSearchParams(seen[0].body);
  assert.equal(form.get("client_secret"), "csecret");
  assert.equal(form.get("code_verifier"), "v");
  assert.equal(seen[0].url, "https://oauth2.googleapis.com/token");
});

test("refresh recusado (invalid_grant) vira unauthorized e não é repetido", async () => {
  const oauth = new HttpGoogleOAuth({ clientId: "c", clientSecret: "s" }, async () => json(400, { error: "invalid_grant" }));
  await assert.rejects(oauth.refreshAccessToken("r"), { kind: "unauthorized" });
});

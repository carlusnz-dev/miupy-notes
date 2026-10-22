import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createKit, createTestServer, knownNote } from "../calendar.test-kit.js";
import { GoogleApiError } from "../google/google-calendar.client.js";
import { SCOPE_MIRROR, SCOPE_REFLECT } from "../google/google-oauth.js";

const kit = createKit();
const server = createTestServer(kit);
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  baseUrl = `http://127.0.0.1:${address.port}/v1/calendar`;
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type EventBody = { id: string; title: string; allDay: boolean; start: string; end: string; timeZone: string | null; version: number; links: { kind: string; id: string }[]; readOnly: boolean; source: string };
type PageBody = { items: EventBody[]; nextCursor: string | null };

function call(owner: string | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) headers["x-test-owner"] = owner;
  return fetch(`${baseUrl}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const timed = (extra: object = {}) => ({ title: "Reunião", start: "2026-10-21T09:00:00-03:00", end: "2026-10-21T10:00:00-03:00", timeZone: "America/Sao_Paulo", ...extra });
async function create(owner: string, body: object): Promise<EventBody> {
  const response = await call(owner, "/events", { method: "POST", body });
  assert.ok(response.status === 201 || response.status === 200, `criação respondeu ${response.status}`);
  return await response.json() as EventBody;
}

test("sem principal, qualquer rota responde 401", async () => {
  assert.equal((await call(null, "/events")).status, 401);
  assert.equal((await call(null, "/google")).status, 401);
});

test("criar normaliza o horário para UTC, guarda o fuso e nunca devolve ownerId", async () => {
  const response = await call("alice", "/events", { method: "POST", body: timed() });
  assert.equal(response.status, 201);
  const event = await response.json() as EventBody & { ownerId?: string };
  assert.equal(event.start, "2026-10-21T12:00:00.000Z");
  assert.equal(event.timeZone, "America/Sao_Paulo");
  assert.equal(event.version, 1);
  assert.equal(event.source, "local");
  assert.equal(event.ownerId, undefined);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ ownerId: "bob" }) })).status, 400);
});

test("evento com hora sem fuso, fuso inexistente ou fim anterior ao início é recusado", async () => {
  assert.equal((await call("alice", "/events", { method: "POST", body: { title: "x", start: "2026-10-21T09:00:00Z", end: "2026-10-21T10:00:00Z" } })).status, 400);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ timeZone: "Nada/Nada" }) })).status, 400);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ end: "2026-10-21T08:00:00-03:00" }) })).status, 400);
});

test("dia inteiro usa datas, termina no último dia e não tem fuso", async () => {
  const event = await create("alice", { title: "Feriado", allDay: true, start: "2026-11-02", end: "2026-11-03", timeZone: "Asia/Tokyo" });
  assert.deepEqual([event.start, event.end, event.timeZone], ["2026-11-02", "2026-11-03", null]);
  assert.equal((await call("alice", "/events", { method: "POST", body: { title: "x", allDay: true, start: "2026-11-03", end: "2026-11-02" } })).status, 400);
  assert.equal((await call("alice", "/events", { method: "POST", body: { title: "x", allDay: true, start: "2026-11-02T00:00:00Z", end: "2026-11-02" } })).status, 400);
});

test("outro proprietário recebe 404 em leitura, edição e exclusão, e não vê o evento na lista", async () => {
  const event = await create("alice", timed({ title: "Privado" }));
  assert.equal((await call("bob", `/events/${event.id}`)).status, 404);
  assert.equal((await call("bob", `/events/${event.id}`, { method: "PATCH", body: { version: 1, title: "x" } })).status, 404);
  assert.equal((await call("bob", `/events/${event.id}?version=1`, { method: "DELETE" })).status, 404);
  const bobPage = await (await call("bob", "/events")).json() as PageBody;
  assert.equal(bobPage.items.length, 0);
  assert.equal((await call("alice", `/events/${event.id}`)).status, 200);
});

test("PATCH exige a versão lida: divergente é 409 e a boa incrementa", async () => {
  const event = await create("alice", timed());
  const ok = await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 1, title: "Novo" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json() as EventBody).version, 2);
  const stale = await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 1, title: "Velho" } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { error: { code: string } }).error.code, "CONFLICT");
  assert.equal((await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 2 } })).status, 400);
});

test("trocar entre dia inteiro e com hora exige informar início e fim novos", async () => {
  const event = await create("alice", timed());
  assert.equal((await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 1, allDay: true } })).status, 400);
  const changed = await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 1, allDay: true, start: "2026-10-21", end: "2026-10-21" } });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json() as EventBody).timeZone, null);
});

test("mudar só o fuso mantém o instante e muda a exibição", async () => {
  const event = await create("alice", timed());
  const changed = await (await call("alice", `/events/${event.id}`, { method: "PATCH", body: { version: 1, timeZone: "Asia/Tokyo" } })).json() as EventBody;
  assert.equal(changed.start, event.start);
  assert.equal(changed.timeZone, "Asia/Tokyo");
});

test("excluir exige a versão e responde 409, 204 e depois 404", async () => {
  const event = await create("alice", timed());
  assert.equal((await call("alice", `/events/${event.id}`, { method: "DELETE" })).status, 400);
  assert.equal((await call("alice", `/events/${event.id}?version=7`, { method: "DELETE" })).status, 409);
  assert.equal((await call("alice", `/events/${event.id}?version=1`, { method: "DELETE" })).status, 204);
  assert.equal((await call("alice", `/events/${event.id}?version=1`, { method: "DELETE" })).status, 404);
});

test("POST com id do cliente é idempotente: repetição devolve 200 e conteúdo diferente é 409", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const first = await call("alice", "/events", { method: "POST", body: timed({ id }) });
  assert.equal(first.status, 201);
  const replay = await call("alice", "/events", { method: "POST", body: timed({ id }) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as EventBody).id, id);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ id, title: "Outro" }) })).status, 409);
  const all = await (await call("alice", "/events?limit=100")).json() as PageBody;
  assert.equal(all.items.filter((item) => item.id === id).length, 1);
  // Outro proprietário pode usar o mesmo UUID sem colidir.
  assert.equal((await call("bob", "/events", { method: "POST", body: timed({ id }) })).status, 201);
});

test("relações: nota do próprio dono e evento existente passam; nota alheia ou inexistente é 400 genérico", async () => {
  const other = await create("alice", timed({ title: "Alvo" }));
  const ok = await create("alice", timed({ links: [{ kind: "note", id: knownNote }, { kind: "event", id: other.id }, { kind: "note", id: knownNote }] }));
  assert.equal(ok.links.length, 2);
  assert.equal((await call("bob", "/events", { method: "POST", body: timed({ links: [{ kind: "note", id: knownNote }] }) })).status, 400);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ links: [{ kind: "event", id: "99999999-2222-4333-8444-555555555555" }] }) })).status, 400);
  assert.equal((await call("alice", `/events/${ok.id}`, { method: "PATCH", body: { version: 1, links: [{ kind: "event", id: ok.id }] } })).status, 400);
  assert.equal((await call("alice", "/events", { method: "POST", body: timed({ links: [{ kind: "biblioteca", id: knownNote }] }) })).status, 400);
});

test("lista pagina com cursor, filtra por período e rejeita parâmetros desconhecidos", async () => {
  const owner = "carol";
  for (let day = 1; day <= 5; day++) await create(owner, { title: `D${day}`, start: `2026-12-0${day}T10:00:00Z`, end: `2026-12-0${day}T11:00:00Z`, timeZone: "UTC" });
  await create(owner, { title: "Longo", allDay: true, start: "2026-11-28", end: "2026-12-02" });
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await (await call(owner, `/events?limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json() as PageBody;
    seen.push(...page.items.map((item) => item.title));
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 6);

  const range = await (await call(owner, "/events?from=2026-12-02T00:00:00Z&to=2026-12-04T00:00:00Z&limit=100")).json() as PageBody;
  assert.deepEqual(range.items.map((item) => item.title).sort(), ["D2", "D3", "Longo"]);
  assert.equal((await call(owner, "/events?from=2026-12-04T00:00:00Z&to=2026-12-02T00:00:00Z")).status, 400);
  assert.equal((await call(owner, "/events?ownerId=bob")).status, 400);
});

test("espelhos do Google são somente leitura para edição e exclusão", async () => {
  const mirror = await seedMirror();
  assert.equal(mirror.readOnly, true);
  const patch = await call("alice", `/events/${mirror.id}`, { method: "PATCH", body: { version: mirror.version, title: "x" } });
  assert.equal(patch.status, 409);
  assert.equal((await patch.json() as { error: { code: string } }).error.code, "READ_ONLY_EVENT");
  assert.equal((await call("alice", `/events/${mirror.id}?version=${mirror.version}`, { method: "DELETE" })).status, 409);
});

async function seedMirror(): Promise<EventBody> {
  const { toMirrorEvent } = await import("../google/google-mapping.js");
  const event = toMirrorEvent({ id: "g-ro", etag: "\"1\"", summary: "Do Google", start: { dateTime: "2026-10-21T10:00:00Z" }, end: { dateTime: "2026-10-21T11:00:00Z" } }, { ownerId: "alice", calendarId: "primary", connectionId: "c1", syncedAt: "2026-10-21T00:00:00.000Z", existing: null })!;
  await kit.repository.upsertMirror(event);
  return await (await call("alice", `/events/${event.id}`)).json() as EventBody;
}

test("sync expõe Retry-After do Google no HTTP 429 e 502 sem mudar o envelope", async () => {
  kit.oauth.grantedScopes = [SCOPE_MIRROR];
  await kit.credentials.put("alice", "login-refresh-secret");
  await kit.integration.connect("alice");
  for (const [kind, status, code] of [["rate_limited", 429, "RATE_LIMITED"], ["unavailable", 502, "UPSTREAM_UNAVAILABLE"]] as const) {
    kit.google.failures.list = [new GoogleApiError(kind, 600_001)];
    const response = await call("alice", "/google/sync", { method: "POST", body: {} });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("retry-after"), "601");
    assert.equal(response.headers.get("access-control-expose-headers"), "Retry-After");
    const body = await response.json() as { error: { code: string; requestId: string } };
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.requestId, "string");
    assert.equal(JSON.stringify(body).includes("refresh-secret"), false);
  }
});

test("POST /google/connection ativa pelo login sem corpo, recusa corpo extra e o fluxo de autorização por navegador não existe mais", async () => {
  kit.oauth.grantedScopes = [SCOPE_MIRROR];
  kit.oauth.subject = "connector";
  await kit.credentials.put("connector", "login-refresh-secret");
  assert.equal((await call("connector", "/google/connection", { method: "POST", body: { code: "x", state: "y" } })).status, 400);
  const connected = await call("connector", "/google/connection", { method: "POST", body: {} });
  assert.equal(connected.status, 200);
  const body = await connected.json() as { state: string; mode: string; scopes: string[] };
  assert.deepEqual([body.state, body.mode, body.scopes], ["connected", "mirror", [SCOPE_MIRROR]]);
  assert.equal(JSON.stringify(body).includes("login-refresh-secret"), false);
  assert.equal((await call("connector", "/google/authorization", { method: "POST", body: {} })).status, 404);
});

test("sem Calendar no login, POST /google/connection responde 409 SCOPE_NOT_GRANTED com mensagem acionável", async () => {
  kit.oauth.grantedScopes = [];
  kit.oauth.subject = "no-calendar";
  await kit.credentials.put("no-calendar", "login-refresh-secret");
  const response = await call("no-calendar", "/google/connection", { method: "POST", body: {} });
  assert.equal(response.status, 409);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "SCOPE_NOT_GRANTED");
  assert.match(body.error.message, /login do Google/);
});

test("POST/PATCH com envio explícito reconcilia falha Google e DELETE refletido aceita repetição remota", async () => {
  const owner = "writer";
  kit.oauth.grantedScopes = [SCOPE_REFLECT];
  kit.oauth.subject = owner;
  await kit.credentials.put(owner, "login-refresh-secret");
  await kit.integration.connect(owner);
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  kit.google.failures.insert = [new GoogleApiError("unavailable")];
  const body = timed({ id, sendToGoogle: true });
  assert.equal((await call(owner, "/events", { method: "POST", body })).status, 502);
  assert.equal((await call(owner, "/events", { method: "POST", body })).status, 200);
  let current = await kit.repository.findById(owner, id); assert.ok(current?.reflection);
  kit.google.failures.update = [new GoogleApiError("unavailable")];
  const patch = { version: current.version, title: "Editado", sendToGoogle: true };
  assert.equal((await call(owner, `/events/${id}`, { method: "PATCH", body: patch })).status, 502);
  assert.equal((await call(owner, `/events/${id}`, { method: "PATCH", body: patch })).status, 200);
  current = await kit.repository.findById(owner, id); assert.ok(current?.reflection);
  // DELETE remoto confirmado, mas falha local: a referência permanece e o retry tolera 404 remoto.
  const remove = kit.repository.delete.bind(kit.repository);
  let failed = false;
  kit.repository.delete = async (...args) => { if (args[1] === id && !failed) { failed = true; throw new Error("synthetic persistence failure"); } return remove(...args); };
  try {
    assert.equal((await call(owner, `/events/${id}?version=${current.version}`, { method: "DELETE" })).status, 500);
    assert.ok((await kit.repository.findById(owner, id))?.reflection);
    assert.equal((await call(owner, `/events/${id}?version=${current.version}`, { method: "DELETE" })).status, 204);
  } finally { kit.repository.delete = remove; }
  assert.equal(await kit.repository.findById(owner, id), null);
});

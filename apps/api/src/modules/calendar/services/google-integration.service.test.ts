import assert from "node:assert/strict";
import { test } from "node:test";
import { createKit } from "../calendar.test-kit.js";
import { GoogleApiError } from "../google/google-calendar.client.js";
import { SCOPE_MIRROR, SCOPE_REFLECT } from "../google/google-oauth.js";
import { mirrorId } from "../google/google-mapping.js";

const owner = "alice";
const challenge = "a".repeat(43);
const verifier = "b".repeat(43);
const redirectUri = "http://127.0.0.1:53682/callback";
const at = (hour: number) => new Date(Date.UTC(2026, 9, 21, hour));

const timedInput = { title: "Almoço", description: "", location: "", allDay: false, start: "2026-10-21T15:00:00.000Z", end: "2026-10-21T16:00:00.000Z", timeZone: "America/Sao_Paulo", links: [] as [] };

async function connect(kit: ReturnType<typeof createKit>, mode: "mirror" | "reflect", scopes?: string[]) {
  kit.oauth.grantedScopes = scopes ?? [mode === "reflect" ? SCOPE_REFLECT : SCOPE_MIRROR];
  const { state } = await kit.integration.authorize(owner, { mode, redirectUri, codeChallenge: challenge });
  return kit.integration.connect(owner, { state, code: "code", codeVerifier: verifier, redirectUri });
}

const gEvent = (id: string, extra: object = {}) => ({ id, summary: id, start: { dateTime: "2026-10-22T10:00:00-03:00" }, end: { dateTime: "2026-10-22T11:00:00-03:00" }, ...extra });

test("sem cliente OAuth/cofre o status é não configurado e nada é chamado", async () => {
  const kit = createKit({ configured: false });
  assert.equal((await kit.integration.status(owner)).state, "not_configured");
  await assert.rejects(kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge }), { code: "INTEGRATION_NOT_CONFIGURED" });
  await assert.rejects(kit.integration.sync(owner), { code: "INTEGRATION_NOT_CONFIGURED" });
  assert.deepEqual(kit.google.calls, []);
});

test("configurado mas sem consentimento: não conectado, e sincronizar/enviar são recusados", async () => {
  const kit = createKit();
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  await assert.rejects(kit.integration.sync(owner), { code: "INTEGRATION_NOT_CONNECTED" });
  assert.deepEqual(kit.google.calls, []);
});

test("autorização pede só o escopo do modo, sem escopos de login, e guarda o token fora do cadastro", async () => {
  const kit = createKit({ now: () => at(10) });
  const { authorizationUrl } = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  const scope = new URL(authorizationUrl).searchParams.get("scope");
  assert.equal(scope, SCOPE_MIRROR);
  const status = await connect(kit, "mirror");
  assert.deepEqual([status.state, status.mode, status.scopes], ["connected", "mirror", [SCOPE_MIRROR]]);
  assert.equal(await kit.credentials.get(owner), "refresh-secret");
  assert.equal(JSON.stringify(status).includes("refresh-secret"), false);
});

test("o state é de uso único, expira e deve casar com o redirectUri", async () => {
  let clock = at(10);
  const kit = createKit({ now: () => clock });
  kit.oauth.grantedScopes = [SCOPE_MIRROR];
  const first = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  await assert.rejects(kit.integration.connect(owner, { state: first.state.replace(/.$/, "x"), code: "c", codeVerifier: verifier, redirectUri }), { status: 400 });
  // A tentativa errada consumiu a autorização pendente.
  await assert.rejects(kit.integration.connect(owner, { state: first.state, code: "c", codeVerifier: verifier, redirectUri }), { status: 400 });

  const second = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  await assert.rejects(kit.integration.connect(owner, { state: second.state, code: "c", codeVerifier: verifier, redirectUri: "http://127.0.0.1:1/outro" }), { status: 400 });

  const third = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  clock = at(11);
  await assert.rejects(kit.integration.connect(owner, { state: third.state, code: "c", codeVerifier: verifier, redirectUri }), { status: 400 });

  const fourth = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  assert.equal((await kit.integration.connect(owner, { state: fourth.state, code: "c", codeVerifier: verifier, redirectUri })).state, "connected");
  await assert.rejects(kit.integration.connect(owner, { state: fourth.state, code: "c", codeVerifier: verifier, redirectUri }), { status: 400 });
  // Outro proprietário não consome o state de alice.
  await assert.rejects(kit.integration.connect("bob", { state: fourth.state, code: "c", codeVerifier: verifier, redirectUri }), { status: 400 });
});

test("consentimento granular: sem o escopo pedido não conecta e revoga o token recebido", async () => {
  const kit = createKit();
  await assert.rejects(connect(kit, "reflect", ["openid"]), { code: "SCOPE_NOT_GRANTED" });
  assert.deepEqual(kit.oauth.revoked, ["refresh-secret"]);
  assert.equal(await kit.credentials.get(owner), null);
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
});

test("sincronização completa pagina até o token final, grava espelhos e não duplica ao repetir", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  ["a", "b", "c", "d", "e"].forEach((id) => kit.google.seed(gEvent(id)));
  const first = await kit.integration.sync(owner);
  assert.deepEqual([first.kind, first.pages, first.upserted, first.resynced], ["full", 3, 5, false]);
  const page = await kit.repository.list(owner, { limit: 100 });
  assert.equal(page.items.length, 5);
  assert.ok(page.items.every((event) => event.source === "google" && event.timeZone === "America/Sao_Paulo"));
  assert.equal((await kit.integration.status(owner)).hasSyncCursor, true);

  const second = await kit.integration.sync(owner);
  assert.deepEqual([second.kind, second.upserted, second.deleted], ["incremental", 0, 0]);
  assert.equal((await kit.repository.list(owner, { limit: 100 })).items.length, 5);
});

test("sincronização incremental aplica alteração e cancelamento", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  kit.google.seed(gEvent("b"));
  await kit.integration.sync(owner);
  kit.google.seed(gEvent("a", { summary: "A renomeado" }));
  kit.google.remove("b");
  const result = await kit.integration.sync(owner);
  assert.deepEqual([result.kind, result.upserted, result.deleted], ["incremental", 1, 1]);
  const items = (await kit.repository.list(owner, { limit: 100 })).items;
  assert.deepEqual(items.map((event) => event.title), ["A renomeado"]);
  assert.equal(items[0].version, 2);
});

test("410 invalida o cursor: apaga o espelho, refaz a sincronização completa e sinaliza", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  kit.google.seed(gEvent("b"));
  await kit.integration.sync(owner);
  kit.google.remove("b");
  kit.google.invalidateTokens();
  const result = await kit.integration.sync(owner);
  assert.deepEqual([result.kind, result.resynced, result.upserted], ["full", true, 1]);
  assert.deepEqual((await kit.repository.list(owner, { limit: 100 })).items.map((event) => event.title), ["a"]);
});

test("sincronização só afeta o dono: espelhos de outro proprietário e eventos locais ficam intactos", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  const local = (await kit.service.create(owner, timedInput)).event;
  const other = (await kit.service.create("bob", timedInput)).event;
  kit.google.seed(gEvent("a"));
  kit.google.invalidateTokens();
  await kit.integration.sync(owner);
  kit.google.invalidateTokens();
  await kit.integration.sync(owner);
  assert.ok(await kit.repository.findById(owner, local.id));
  assert.ok(await kit.repository.findById("bob", other.id));
  assert.equal(await kit.repository.findById("bob", mirrorId(owner, "primary", "a")), null);
});

test("limite do Google (429) fica visível no status e não marca o espelho como em dia", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  kit.google.failures.list = [new GoogleApiError("rate_limited")];
  await assert.rejects(kit.integration.sync(owner), { status: 429, code: "RATE_LIMITED" });
  const status = await kit.integration.status(owner);
  assert.deepEqual([status.state, status.lastError, status.lastSyncAt, status.hasSyncCursor], ["connected", "RATE_LIMITED", null, false]);
  assert.equal((await kit.integration.sync(owner)).upserted, 1);
  assert.equal((await kit.integration.status(owner)).lastError, null);
});

test("acesso recusado leva a precisa reautorizar e bloqueia novas chamadas", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.failures.list = [new GoogleApiError("unauthorized")];
  await assert.rejects(kit.integration.sync(owner), { code: "REAUTH_REQUIRED" });
  assert.equal((await kit.integration.status(owner)).state, "needs_reauth");
  const calls = kit.google.calls.length;
  await assert.rejects(kit.integration.sync(owner), { code: "REAUTH_REQUIRED" });
  assert.equal(kit.google.calls.length, calls);
});

test("enviar ao Google exige permissão de escrita e envia uma vez com ID derivado e marca própria", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "mirror");
  await assert.rejects(kit.integration.reflect(owner, event.id), { code: "REFLECTION_NOT_ENABLED" });
  await kit.integration.disconnect(owner);
  await connect(kit, "reflect");
  const reflected = await kit.integration.reflect(owner, event.id);
  assert.equal(reflected.reflection?.googleEventId, event.id.replaceAll("-", ""));
  assert.equal(reflected.reflection?.reflectedVersion, reflected.version);
  assert.equal(kit.google.calls.filter((call) => call === "insert").length, 1);
  const remote = kit.google.events.get(event.id.replaceAll("-", ""))!;
  assert.equal(remote.extendedProperties?.private?.miupyEventId, event.id);
});

test("reenvio após resposta perdida reconcilia pelo ID em vez de duplicar", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  // Primeira tentativa chega ao Google, mas o app não grava o vínculo (simula resposta perdida).
  const { toGoogleBody } = await import("../google/google-mapping.js");
  await kit.google.insertEvent(owner, "primary", toGoogleBody(event));
  const reflected = await kit.integration.reflect(owner, event.id);
  assert.ok(reflected.reflection);
  assert.equal(kit.google.events.size, 1);
});

test("a cópia enviada não volta como espelho duplicado na sincronização", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  await kit.integration.reflect(owner, event.id);
  kit.google.seed(gEvent("de-fora"));
  await kit.integration.sync(owner);
  const items = (await kit.repository.list(owner, { limit: 100 })).items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.source).sort(), ["google", "local"]);
});

test("atualizar o evento reenviado usa If-Match; edição no Google é conflito visível e não é sobrescrita", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  const first = await kit.integration.reflect(owner, event.id);
  const edited = await kit.service.update(owner, event.id, { version: first.version, title: "Almoço longo" });
  const second = await kit.integration.reflect(owner, event.id);
  assert.equal(second.reflection?.reflectedVersion, second.version);
  assert.equal(kit.google.events.get(event.id.replaceAll("-", ""))!.summary, "Almoço longo");
  assert.ok(edited.version < second.version);

  // Alguém edita direto no Google: o ETag guardado fica velho.
  const googleId = event.id.replaceAll("-", "");
  kit.google.seed({ ...kit.google.events.get(googleId)!, summary: "Mudado no Google" });
  const local = await kit.service.update(owner, event.id, { version: second.version, title: "Outra mudança local" });
  await assert.rejects(kit.integration.reflect(owner, event.id), { code: "GOOGLE_CONFLICT" });
  assert.equal(kit.google.events.get(googleId)!.summary, "Mudado no Google");
  assert.equal((await kit.service.findById(owner, event.id)).version, local.version);
});

test("412 quando o Google já tem exatamente o conteúdo local adota o ETag em vez de acusar conflito", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  const first = await kit.integration.reflect(owner, event.id);
  const googleId = event.id.replaceAll("-", "");
  // O Google recebeu a atualização, mas o app não guardou o ETag novo.
  const body = (await import("../google/google-mapping.js")).toGoogleBody(first);
  await kit.google.updateEvent(owner, "primary", googleId, body, kit.google.events.get(googleId)!.etag!);
  const again = await kit.integration.reflect(owner, event.id);
  assert.equal(again.reflection?.etag, kit.google.events.get(googleId)!.etag);
});

test("excluir evento enviado exige remover o envio; desfazer apaga no Google com If-Match ou só o vínculo", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  const reflected = await kit.integration.reflect(owner, event.id);
  await assert.rejects(kit.service.delete(owner, event.id, reflected.version), { code: "REFLECTION_ACTIVE" });
  const detached = await kit.integration.unreflect(owner, event.id, { keepRemote: true });
  assert.equal(detached.reflection, null);
  assert.equal(kit.google.events.size, 1);

  const second = await kit.service.create(owner, { ...timedInput, title: "Outro" });
  await kit.integration.reflect(owner, second.event.id);
  const removed = await kit.integration.unreflect(owner, second.event.id, { keepRemote: false });
  assert.equal(removed.reflection, null);
  assert.equal(kit.google.events.has(second.event.id.replaceAll("-", "")), false);
  await kit.service.delete(owner, second.event.id, removed.version);
});

test("desconectar revoga o token, apaga credencial e espelhos e preserva eventos locais", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  await kit.integration.sync(owner);
  const status = await kit.integration.disconnect(owner);
  assert.equal(status.state, "not_connected");
  assert.deepEqual(kit.oauth.revoked, ["refresh-secret"]);
  assert.equal(await kit.credentials.get(owner), null);
  const items = (await kit.repository.list(owner, { limit: 100 })).items;
  assert.deepEqual(items.map((item) => item.id), [event.id]);
});

test("mapeia dia inteiro do Google (fim exclusivo) e usa o fuso do calendário quando o evento não traz um", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.seed({ id: "dia", summary: "Viagem", start: { date: "2026-11-02" }, end: { date: "2026-11-05" } });
  kit.google.seed({ id: "hora", summary: "Call", start: { dateTime: "2026-11-02T09:00:00-03:00" }, end: { dateTime: "2026-11-02T10:00:00-03:00" } });
  kit.google.seed({ id: "vazio", summary: "Sem datas" });
  await kit.integration.sync(owner);
  const items = (await kit.repository.list(owner, { limit: 100 })).items;
  const day = items.find((item) => item.title === "Viagem")!;
  assert.deepEqual([day.allDay, day.start, day.end, day.timeZone], [true, "2026-11-02", "2026-11-04", null]);
  const call = items.find((item) => item.title === "Call")!;
  assert.deepEqual([call.start, call.timeZone], ["2026-11-02T12:00:00.000Z", "America/Sao_Paulo"]);
  assert.equal(items.length, 2);
});

test("regressão: sincronizar a cópia editada no Google não adota o ETag; o envio seguinte vira GOOGLE_CONFLICT e preserva a edição remota", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  await kit.integration.reflect(owner, event.id);
  const googleId = event.id.replaceAll("-", "");
  const sentEtag = (await kit.repository.findById(owner, event.id))!.reflection!.etag;
  kit.google.seed({ ...kit.google.events.get(googleId)!, summary: "alterado no Google" });
  await kit.integration.sync(owner);
  assert.equal((await kit.repository.findById(owner, event.id))!.reflection!.etag, sentEtag);
  await assert.rejects(kit.integration.reflect(owner, event.id), { code: "GOOGLE_CONFLICT" });
  assert.equal(kit.google.events.get(googleId)!.summary, "alterado no Google");
});

test("sincronizar a cópia com conteúdo idêntico (só ETag mudou) adota o ETag novo", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  await kit.integration.reflect(owner, event.id);
  const googleId = event.id.replaceAll("-", "");
  const reseeded = kit.google.seed({ ...kit.google.events.get(googleId)! });
  await kit.integration.sync(owner);
  assert.equal((await kit.repository.findById(owner, event.id))!.reflection!.etag, reseeded.etag);
});

test("regressão: sincronização em voo não ressuscita a conexão desconectada nem regrava espelhos", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "reflect");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const original = kit.google.listEvents.bind(kit.google);
  kit.google.listEvents = async (...args) => { await waiting; return original(...args); };
  kit.google.seed(gEvent("a"));
  const syncing = kit.integration.sync(owner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await kit.integration.disconnect(owner);
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  release();
  await assert.rejects(syncing, { code: "INTEGRATION_NOT_CONNECTED" });
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  assert.deepEqual((await kit.repository.list(owner, { limit: 100 })).items, []);
});

test("regressão: erro tardio de uma conexão antiga não altera a conexão refeita; só os espelhos dela são removidos", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  kit.google.listEvents = async () => { await waiting; throw new GoogleApiError("rate_limited"); };
  const syncing = kit.integration.sync(owner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await kit.integration.disconnect(owner);
  await connect(kit, "mirror");
  release();
  await assert.rejects(syncing, { code: "RATE_LIMITED" });
  const status = await kit.integration.status(owner);
  assert.deepEqual([status.state, status.lastError], ["connected", null]);
});

test("regressão: espelhos de uma conexão antiga gravados após a reconexão são limpos sem tocar nos da nova", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  const old = (await kit.repository.getConnection(owner))!;
  await kit.integration.disconnect(owner);
  await connect(kit, "mirror");
  kit.google.seed(gEvent("novo"));
  await kit.integration.sync(owner);
  const { toMirrorEvent } = await import("../google/google-mapping.js");
  await kit.repository.upsertMirror(toMirrorEvent(gEvent("velho"), { ownerId: owner, calendarId: "primary", connectionId: old.connectionId, syncedAt: at(12).toISOString(), existing: null })!);
  assert.equal(await kit.repository.deleteAllMirrors(owner, old.connectionId), 1);
  assert.deepEqual((await kit.repository.list(owner, { limit: 100 })).items.map((item) => item.title), ["novo"]);
});

test("regressão: insert 409 com conteúdo remoto divergente é conflito explícito e não sobrescreve o Google", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  const googleId = event.id.replaceAll("-", "");
  kit.google.seed({ id: googleId, summary: "remoto divergente", start: { dateTime: event.start }, end: { dateTime: event.end } });
  await assert.rejects(kit.integration.reflect(owner, event.id), { code: "GOOGLE_CONFLICT" });
  assert.equal(kit.google.events.get(googleId)!.summary, "remoto divergente");
  assert.equal(kit.google.calls.includes("update"), false);
  assert.equal((await kit.repository.findById(owner, event.id))!.reflection, null);
});


test("duas conclusões simultâneas consomem o state uma única vez", async () => {
  const kit = createKit(); kit.oauth.grantedScopes = [SCOPE_MIRROR];
  const { state } = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  let exchanges = 0;
  const exchange = kit.oauth.exchangeCode.bind(kit.oauth);
  kit.oauth.exchangeCode = async () => { exchanges++; return exchange(); };
  const results = await Promise.allSettled([1, 2].map(() => kit.integration.connect(owner, { state, code: "c", codeVerifier: verifier, redirectUri })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(exchanges, 1);
});

test("janela inicial é estável entre páginas e incremental omite ambos limites", async () => {
  const kit = createKit({ now: () => at(12) }); await connect(kit, "mirror");
  ["a", "b", "c"].forEach((id) => kit.google.seed(gEvent(id)));
  const seen: Array<import("../google/google-calendar.client.js").ListParams> = [];
  const list = kit.google.listEvents.bind(kit.google);
  kit.google.listEvents = async (o, c, params) => { seen.push(params); return list(o, c, params); };
  await kit.integration.sync(owner);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].timeMin, new Date(at(12).getTime() - 30 * 86400000).toISOString());
  assert.equal(seen[0].timeMax, new Date(at(12).getTime() + 366 * 86400000).toISOString());
  assert.equal(seen[0].timeMax, seen[1].timeMax);
  seen.length = 0; await kit.integration.sync(owner);
  assert.equal(seen[0].timeMin, undefined); assert.equal(seen[0].timeMax, undefined);
});

test("espelho exige escrita, versão e ETag; conflito remoto não sobrescreve e retry idêntico reconcilia", async () => {
  const kit = createKit(); await connect(kit, "mirror"); kit.google.seed(gEvent("a")); await kit.integration.sync(owner);
  let event = (await kit.repository.list(owner, { limit: 10 })).items[0];
  await assert.rejects(kit.integration.updateMirror(owner, event.id, { version: event.version, title: "x" }), { code: "READ_ONLY_EVENT" });
  await connect(kit, "reflect"); await kit.integration.sync(owner);
  event = (await kit.repository.list(owner, { limit: 10 })).items[0];
  await assert.rejects(kit.integration.updateMirror(owner, event.id, { version: event.version + 1, title: "x" }), { code: "CONFLICT" });
  const saved = await kit.integration.updateMirror(owner, event.id, { version: event.version, title: "x" });
  assert.equal(saved.title, "x"); assert.equal(saved.version, event.version + 1);
  // Simula resposta perdida depois do PATCH: o remoto já contém a intenção, mas o espelho mantém o ETag antigo.
  kit.google.seed(gEvent("a", { summary: "y" }));
  const replay = await kit.integration.updateMirror(owner, saved.id, { version: saved.version, title: "y" });
  assert.equal(replay.title, "y");
  kit.google.seed(gEvent("a", { summary: "edição remota" }));
  await assert.rejects(kit.integration.deleteMirror(owner, replay.id, replay.version), { code: "GOOGLE_CONFLICT" });
  assert.equal(kit.google.events.get("a")?.summary, "edição remota");
});

test("exclusão refletida conserva vínculo se edição local vencer após DELETE remoto", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const local = (await kit.service.create(owner, timedInput)).event;
  const reflected = await kit.integration.reflect(owner, local.id);
  const remove = kit.google.deleteEvent.bind(kit.google);
  let edited = false;
  kit.google.deleteEvent = async (...args) => {
    await remove(...args);
    if (!edited) { edited = true; await kit.service.update(owner, local.id, { version: reflected.version, title: "edição concorrente" }); }
  };
  await assert.rejects(kit.integration.deleteReflected(owner, local.id, reflected.version), { code: "CONFLICT" });
  const current = await kit.repository.findById(owner, local.id);
  assert.ok(current?.reflection); assert.equal(current.title, "edição concorrente");
  await kit.integration.deleteReflected(owner, local.id, current.version);
  assert.equal(await kit.repository.findById(owner, local.id), null);
});

test("desconectar durante a troca OAuth aguarda e remove o grant tardio no processo local", async () => {
  const kit = createKit(); kit.oauth.grantedScopes = [SCOPE_MIRROR];
  const { state } = await kit.integration.authorize(owner, { mode: "mirror", redirectUri, codeChallenge: challenge });
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => { started = r; });
  const wait = new Promise<void>((r) => { release = r; });
  kit.oauth.exchangeCode = async () => { started(); await wait; return { refreshToken: "late-synthetic", scopes: [SCOPE_MIRROR] }; };
  const connecting = kit.integration.connect(owner, { state, code: "c", codeVerifier: verifier, redirectUri });
  await entered;
  const disconnecting = kit.integration.disconnect(owner);
  release(); await connecting; await disconnecting;
  assert.equal(await kit.credentials.get(owner), null);
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  assert.deepEqual(kit.oauth.revoked, ["late-synthetic"]);
});

test("editar só título preserva descrição/local remotos maiores que o espelho", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  kit.google.seed(gEvent("long", { description: "d".repeat(9000), location: "l".repeat(400) }));
  await kit.integration.sync(owner);
  const event = (await kit.repository.list(owner, { limit: 10 })).items[0];
  // O formulário manda o rascunho completo, incluindo a descrição truncada que não foi editada.
  await kit.integration.updateMirror(owner, event.id, { version: event.version, title: "novo título", description: event.description, location: event.location });
  assert.equal(kit.google.events.get("long")?.description?.length, 9000);
  assert.equal(kit.google.events.get("long")?.location?.length, 400);
});

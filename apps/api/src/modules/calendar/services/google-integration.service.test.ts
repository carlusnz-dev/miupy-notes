import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../../core/domain/app-error.js";
import { createKit } from "../calendar.test-kit.js";
import { GoogleApiError } from "../google/google-calendar.client.js";
import { SCOPE_MIRROR, SCOPE_REFLECT } from "../google/google-oauth.js";
import { mirrorId } from "../google/google-mapping.js";

const owner = "alice";
const at = (hour: number) => new Date(Date.UTC(2026, 9, 21, hour));

const timedInput = { title: "Almoço", description: "", location: "", allDay: false, start: "2026-10-21T15:00:00.000Z", end: "2026-10-21T16:00:00.000Z", timeZone: "America/Sao_Paulo", links: [] as [] };

/** O login já guardou o refresh token com estes escopos; conectar só confere o que o Google diz ter sido concedido. */
async function connect(kit: ReturnType<typeof createKit>, mode: "mirror" | "reflect", scopes?: string[]) {
  kit.oauth.grantedScopes = scopes ?? [mode === "reflect" ? SCOPE_REFLECT : SCOPE_MIRROR];
  await kit.credentials.put(owner, "login-refresh-secret");
  return kit.integration.connect(owner);
}

const gEvent = (id: string, extra: object = {}) => ({ id, summary: id, start: { dateTime: "2026-10-22T10:00:00-03:00" }, end: { dateTime: "2026-10-22T11:00:00-03:00" }, ...extra });

test("sem cliente OAuth/cofre o status é não configurado e nada é chamado", async () => {
  const kit = createKit({ configured: false });
  assert.equal((await kit.integration.status(owner)).state, "not_configured");
  await assert.rejects(kit.integration.connect(owner), { code: "INTEGRATION_NOT_CONFIGURED" });
  await assert.rejects(kit.integration.sync(owner), { code: "INTEGRATION_NOT_CONFIGURED" });
  assert.deepEqual(kit.google.calls, []);
});

test("configurado mas sem consentimento: não conectado, e sincronizar/enviar são recusados", async () => {
  const kit = createKit();
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  await assert.rejects(kit.integration.sync(owner), { code: "INTEGRATION_NOT_CONNECTED" });
  assert.deepEqual(kit.google.calls, []);
});

test("conectar usa o consentimento do login: sem tela do Google, só escopos Calendar no cadastro e nenhum token nele", async () => {
  const kit = createKit({ now: () => at(10) });
  const status = await connect(kit, "mirror");
  assert.deepEqual([status.state, status.mode, status.scopes], ["connected", "mirror", [SCOPE_MIRROR]]);
  assert.equal(kit.oauth.refreshes, 1);
  assert.equal(JSON.stringify(status).includes("login-refresh-secret"), false);
  assert.equal(JSON.stringify(await kit.repository.getConnection(owner)).includes("login-refresh-secret"), false);
});

test("escopo de escrita concedido no login conecta em modo reflect; reconectar relê os escopos do Google", async () => {
  const kit = createKit();
  assert.deepEqual((await connect(kit, "reflect", [SCOPE_REFLECT, SCOPE_MIRROR])).mode, "reflect");
  // Novo login com menos escopos: a conexão seguinte não usa o cache do access token anterior.
  const downgraded = await connect(kit, "mirror");
  assert.deepEqual([downgraded.mode, downgraded.scopes], ["mirror", [SCOPE_MIRROR]]);
});

test("consentimento granular: login sem Calendar não conecta, não guarda cadastro e não revoga o token do login", async () => {
  const kit = createKit();
  await assert.rejects(connect(kit, "reflect", []), { status: 409, code: "SCOPE_NOT_GRANTED" });
  assert.equal(await kit.repository.getConnection(owner), null);
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
  assert.equal(await kit.credentials.get(owner), "login-refresh-secret");
});

test("sem login no chaveiro, ou com token de outra conta, pede novo login e não conecta", async () => {
  const kit = createKit();
  kit.oauth.grantedScopes = [SCOPE_MIRROR];
  await assert.rejects(kit.integration.connect(owner), { code: "REAUTH_REQUIRED" });
  await kit.credentials.put(owner, "login-refresh-secret");
  kit.oauth.subject = "bob";
  await assert.rejects(kit.integration.connect(owner), { code: "REAUTH_REQUIRED" });
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

test("desconectar apaga cadastro e espelhos, preserva eventos locais e não revoga nem apaga o token do login", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "mirror");
  kit.google.seed(gEvent("a"));
  await kit.integration.sync(owner);
  const status = await kit.integration.disconnect(owner);
  assert.equal(status.state, "not_connected");
  assert.equal(await kit.credentials.get(owner), "login-refresh-secret");
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

test("desconectar durante a conferência dos escopos aguarda e não deixa conexão para trás", async () => {
  const kit = createKit(); kit.oauth.grantedScopes = [SCOPE_MIRROR];
  await kit.credentials.put(owner, "login-refresh-secret");
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => { started = r; });
  const wait = new Promise<void>((r) => { release = r; });
  const refresh = kit.oauth.refreshAccessToken.bind(kit.oauth);
  kit.oauth.refreshAccessToken = async () => { started(); await wait; return refresh(); };
  const connecting = kit.integration.connect(owner);
  await entered;
  const disconnecting = kit.integration.disconnect(owner);
  release(); await connecting; await disconnecting;
  assert.equal((await kit.integration.status(owner)).state, "not_connected");
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

/** Novo login do Tauri: outro refresh token no chaveiro, com os escopos que esse login concedeu. */
async function relogin(kit: ReturnType<typeof createKit>, scopes: string[]) {
  kit.oauth.grantedScopes = scopes;
  await kit.credentials.put(owner, `login-refresh-${scopes.length}-${kit.oauth.refreshes}`);
}

test("regressão: login refeito só com leitura rebaixa a conexão reflect antes de escrever, sem chamar o Google", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  await relogin(kit, [SCOPE_MIRROR]);
  await assert.rejects(kit.integration.reflect(owner, event.id), { code: "REFLECTION_NOT_ENABLED" });
  assert.deepEqual(kit.google.calls, []);
  const status = await kit.integration.status(owner);
  assert.deepEqual([status.state, status.mode, status.scopes], ["connected", "mirror", [SCOPE_MIRROR]]);
  // Login com escrita de novo: o mesmo cadastro volta a refletir sem reconectar.
  await relogin(kit, [SCOPE_REFLECT]);
  assert.ok((await kit.integration.reflect(owner, event.id)).reflection);
});

test("regressão: login refeito sem Calendar marca reautorização e sincronizar responde SCOPE_NOT_GRANTED", async () => {
  const kit = createKit();
  await connect(kit, "reflect");
  await relogin(kit, []);
  await assert.rejects(kit.integration.sync(owner), { status: 409, code: "SCOPE_NOT_GRANTED" });
  assert.deepEqual(kit.google.calls, []);
  assert.deepEqual([(await kit.integration.status(owner)).state, (await kit.integration.status(owner)).lastError], ["needs_reauth", "SCOPE_NOT_GRANTED"]);
});

test("403 do Google não vira 5xx repetível: escopo insuficiente é 409 e reconfere o token; os demais são 403", async () => {
  const kit = createKit({ now: () => at(12) });
  const { event } = await kit.service.create(owner, timedInput);
  await connect(kit, "reflect");
  kit.google.failures.insert = [new GoogleApiError("insufficient_scope")];
  const refreshes = kit.oauth.refreshes;
  await assert.rejects(kit.integration.reflect(owner, event.id), { status: 409, code: "SCOPE_NOT_GRANTED" });
  kit.google.failures.insert = [new GoogleApiError("forbidden")];
  await assert.rejects(kit.integration.reflect(owner, event.id), { status: 403, code: "UPSTREAM_FORBIDDEN" });
  assert.equal(kit.oauth.refreshes, refreshes + 1);
  assert.equal((await kit.integration.status(owner)).state, "connected");
});

test("regressão: evento enviado e apagado no Google vira deleted_remote na sincronização, sem conflito", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const local = (await kit.service.create(owner, timedInput)).event;
  const reflected = await kit.integration.reflect(owner, local.id);
  await kit.integration.sync(owner);
  kit.google.remove(local.id.replaceAll("-", ""));
  await kit.integration.sync(owner);
  const current = await kit.repository.findById(owner, local.id);
  assert.equal(current?.reflection?.state, "deleted_remote");
  assert.equal(current?.version, reflected.version);
  // Salvar de novo grava só o local e não tenta reaparecer no Google nem vira GOOGLE_EVENT_MISSING.
  const edited = await kit.service.update(owner, local.id, { version: current!.version, title: "Novo título" });
  const after = await kit.integration.reflect(owner, edited.id);
  assert.equal(after.reflection?.state, "deleted_remote");
  assert.equal(after.title, "Novo título");
  assert.equal(kit.google.events.size, 0);
});

test("regressão: cancelamento só com ID (sem extendedProperties) também marca o evento enviado", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const local = (await kit.service.create(owner, timedInput)).event;
  await kit.integration.reflect(owner, local.id);
  await kit.integration.sync(owner);
  kit.google.remove(local.id.replaceAll("-", ""), { idOnly: true });
  const result = await kit.integration.sync(owner);
  assert.equal(result.deleted, 1);
  assert.equal((await kit.repository.findById(owner, local.id))?.reflection?.state, "deleted_remote");
});

test("regressão: salvar evento enviado cuja cópia sumiu do Google (404) marca deleted_remote em vez de GOOGLE_EVENT_MISSING", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const local = (await kit.service.create(owner, timedInput)).event;
  await kit.integration.reflect(owner, local.id);
  kit.google.remove(local.id.replaceAll("-", ""));
  const saved = await kit.integration.reflect(owner, local.id);
  assert.equal(saved.reflection?.state, "deleted_remote");
});

for (const kind of ["not_found", "gone", "precondition_failed"] as const) {
  test(`excluir evento enviado conclui a exclusão local quando o DELETE no Google responde ${kind}`, async () => {
    const kit = createKit(); await connect(kit, "reflect");
    const local = (await kit.service.create(owner, timedInput)).event;
    const reflected = await kit.integration.reflect(owner, local.id);
    // 412 com ETag velho num evento que já foi excluído no Google não pode deixar o item preso.
    if (kind === "precondition_failed") kit.google.remove(local.id.replaceAll("-", ""));
    kit.google.failures.delete = [new GoogleApiError(kind)];
    await kit.integration.deleteReflected(owner, local.id, reflected.version);
    assert.equal(await kit.repository.findById(owner, local.id), null);
  });
}

test("evento deleted_remote: excluir não chama o Google e desvincular mantém o evento só local", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const first = (await kit.service.create(owner, timedInput)).event;
  const second = (await kit.service.create(owner, { ...timedInput, title: "Outro" })).event;
  await kit.integration.reflect(owner, first.id); await kit.integration.reflect(owner, second.id);
  await kit.integration.sync(owner);
  kit.google.remove(first.id.replaceAll("-", "")); kit.google.remove(second.id.replaceAll("-", ""));
  await kit.integration.sync(owner);
  kit.google.calls.length = 0;

  const marked = (await kit.repository.findById(owner, first.id))!;
  await kit.integration.deleteReflected(owner, first.id, marked.version);
  assert.equal(await kit.repository.findById(owner, first.id), null);

  const other = (await kit.repository.findById(owner, second.id))!;
  const detached = await kit.integration.unreflect(owner, second.id, { keepRemote: false });
  assert.equal(detached.reflection, null);
  assert.equal(detached.title, other.title);
  assert.deepEqual(kit.google.calls, []);
  await kit.service.delete(owner, second.id, detached.version);
});

test("desvincular (apagar a cópia) com 410 do Google conclui sem erro", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  const local = (await kit.service.create(owner, timedInput)).event;
  await kit.integration.reflect(owner, local.id);
  kit.google.failures.delete = [new GoogleApiError("gone")];
  assert.equal((await kit.integration.unreflect(owner, local.id, { keepRemote: false })).reflection, null);
});

test("espelho editado depois de apagado no Google (404) é removido localmente, sem conflito", async () => {
  const kit = createKit(); await connect(kit, "reflect");
  kit.google.seed(gEvent("a")); await kit.integration.sync(owner);
  const event = (await kit.repository.list(owner, { limit: 10 })).items[0];
  kit.google.remove("a");
  await assert.rejects(kit.integration.updateMirror(owner, event.id, { version: event.version, title: "x" }), { code: "NOT_FOUND" });
  assert.equal(await kit.repository.findById(owner, event.id), null);
});

test("falhas 5xx do Google levam serviço, tipo, status do provedor e causa original para o log", async () => {
  const kit = createKit({ now: () => at(12) });
  await connect(kit, "mirror");
  const network = new TypeError("fetch failed");
  kit.google.failures.list = [new GoogleApiError("unavailable", undefined, { cause: network }), new GoogleApiError("invalid", undefined, { status: 400 })];
  await assert.rejects(kit.integration.sync(owner), (error: unknown) => error instanceof AppError && error.status === 502 && error.cause instanceof GoogleApiError && error.cause.cause === network
    && error.context?.service === "Google Calendar" && error.context.detail === "unavailable");
  await assert.rejects(kit.integration.sync(owner), (error: unknown) => error instanceof AppError && error.code === "UPSTREAM_REJECTED" && error.context?.providerStatus === 400);
});

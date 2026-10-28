import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput, EventDraft } from "../lib/calendar-api";
import { discardOp, draftOf, enqueue, flushOutbox, resolveConflict, sameContent, withOutbox, type CalendarRemote } from "./outbox.js";
import { createIndexedDbCalendarStore, createMemoryCalendarStore } from "./store.js";
import { IDBFactory } from "fake-indexeddb";

const owner = "alice";
const iso = "2026-10-21T12:00:00.000Z";
const draft = (extra: Partial<EventDraft> = {}): EventDraft => ({ title: "Reunião", description: "", location: "", allDay: false, start: iso, end: "2026-10-21T13:00:00.000Z", timeZone: "UTC", links: [], ...extra });
const idA = "00000000-0000-4000-8000-00000000000a";
const server = (extra: Partial<CalendarEventOutput> = {}): CalendarEventOutput => ({ id: idA, ...draft(), source: "local", readOnly: false, external: null, reflection: null, createdAt: iso, updatedAt: iso, version: 1, ...extra });
// Mesma forma de `ApiError` (lib/api-client.ts), sem importar o cliente Axios no teste.
const net = () => Object.assign(new Error("sem rede"), { code: "NETWORK_ERROR" });
const http = (status: number, code: string, retryAfterMs?: number) => Object.assign(new Error("x"), { code, status, retryAfterMs });

/** Servidor falso em memória com falhas programadas; registra as chamadas. */
function remote(initial: CalendarEventOutput[] = []) {
  const events = new Map(initial.map((event) => [event.id, event]));
  const calls: string[] = [];
  const failures: Error[] = [];
  const maybeFail = () => { const next = failures.shift(); if (next) throw next; };
  const api: CalendarRemote = {
    async create(id, d) {
      calls.push(`create:${id}`); maybeFail();
      const existing = events.get(id);
      if (existing) { if (sameContent(existing, d)) return existing; throw http(409, "CONFLICT"); }
      const event = server({ id, ...d }); events.set(id, event); return event;
    },
    async update(id, version, d) {
      calls.push(`update:${id}@${version}`); maybeFail();
      const current = events.get(id);
      if (!current) throw http(404, "NOT_FOUND");
      if (current.version !== version) throw http(409, "CONFLICT");
      const event = { ...current, ...d, version: version + 1 }; events.set(id, event); return event;
    },
    async remove(id, version) {
      calls.push(`remove:${id}@${version}`); maybeFail();
      const current = events.get(id);
      if (!current) throw http(404, "NOT_FOUND");
      if (current.version !== version) throw http(409, "CONFLICT");
      events.delete(id);
    },
    async get(id) { calls.push(`get:${id}`); const found = events.get(id); if (!found) throw http(404, "NOT_FOUND"); return found; },
  };
  return { api, events, calls, failures };
}

test("a intenção é gravada no dispositivo ANTES de qualquer HTTP e aparece como pendente", async () => {
  const store = createMemoryCalendarStore();
  const { calls } = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  assert.deepEqual(calls, []);
  const ops = await store.listOps(owner);
  assert.equal(ops.length, 1);
  const shown = withOutbox(await store.listEvents(owner), ops);
  assert.deepEqual(shown.map((item) => [item.event.id, item.status, item.event.version]), [[idA, "pending", 1]]);
});

test("falha ao gravar no dispositivo é erro visível para quem chama e nada fica pela metade", async () => {
  const store = createMemoryCalendarStore();
  store.failNextPut(new Error("cota excedida"));
  await assert.rejects(enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() }), /cota/);
  assert.deepEqual(await store.listOps(owner), []);
});

test("sem rede o envio fica guardado com backoff e o rascunho não muda; ao voltar a rede, envia uma vez", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "Offline" }) }, 1_000);
  r.failures.push(net());
  const first = await flushOutbox(store, r.api, owner, { now: () => 1_000 });
  assert.deepEqual([first.sent, first.failed, first.stopped], [0, 1, "offline"]);
  const [op] = await store.listOps(owner);
  assert.deepEqual([op.state, op.attempts, op.lastError, op.draft?.title], ["pending", 1, "NETWORK_ERROR", "Offline"]);
  assert.equal(op.nextAttemptAt, 1_000 + 2_000);

  // Antes do prazo nada é tentado; com `force` (botão "tentar agora") tenta.
  const early = await flushOutbox(store, r.api, owner, { now: () => 1_500 });
  assert.equal(early.sent + early.failed, 0);
  const back = await flushOutbox(store, r.api, owner, { now: () => 1_500, force: true });
  assert.equal(back.sent, 1);
  assert.deepEqual(await store.listOps(owner), []);
  assert.equal((await store.listEvents(owner))[0].title, "Offline");
  assert.equal(r.events.size, 1);
});

test("backoff cresce por tentativa, respeita Retry-After do 429 e tem teto", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() }, 0);
  r.failures.push(http(429, "RATE_LIMITED", 7_000), http(503, "UPSTREAM_UNAVAILABLE"), http(500, "INTERNAL_ERROR"));
  await flushOutbox(store, r.api, owner, { now: () => 0, force: true });
  assert.equal((await store.getOp(owner, idA))!.nextAttemptAt, 7_000);
  await flushOutbox(store, r.api, owner, { now: () => 10_000, force: true });
  assert.equal((await store.getOp(owner, idA))!.nextAttemptAt, 10_000 + 4_000);
  await flushOutbox(store, r.api, owner, { now: () => 20_000, force: true });
  assert.equal((await store.getOp(owner, idA))!.nextAttemptAt, 20_000 + 8_000);
});

test("reenvio após resposta perdida não duplica: a criação usa o mesmo ID e o servidor reconhece o conteúdo", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  // O servidor gravou, mas a resposta nunca chegou: o primeiro envio "falha" depois de gravar.
  const original = r.api.create;
  r.api.create = async (id, d) => { await original(id, d); throw net(); };
  await flushOutbox(store, r.api, owner, { force: true });
  r.api.create = original;
  const second = await flushOutbox(store, r.api, owner, { force: true });
  assert.equal(second.sent, 1);
  assert.equal(r.events.size, 1);
});

test("criação com ID já usado por conteúdo diferente vira conflito visível com a cópia do servidor", async () => {
  const store = createMemoryCalendarStore();
  const r = remote([server({ title: "Outro conteúdo" })]);
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "Meu" }) });
  const result = await flushOutbox(store, r.api, owner, { force: true });
  assert.equal(result.conflicts, 1);
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.state, op.draft?.title, op.serverCopy?.title], ["conflict", "Meu", "Outro conteúdo"]);
  assert.equal(withOutbox(await store.listEvents(owner), [op])[0].status, "conflict");
});

test("edição sobre versão antiga é conflito: o rascunho fica intacto e nada é sobrescrito", async () => {
  const store = createMemoryCalendarStore();
  const base = server({ version: 1 });
  await store.putEvents(owner, [base]);
  const r = remote([server({ version: 3, title: "Mudado em outro lugar" })]);
  await enqueue(store, owner, { kind: "update", event: base, draft: draft({ title: "Minha edição" }) });
  const result = await flushOutbox(store, r.api, owner, { force: true });
  assert.equal(result.conflicts, 1);
  assert.equal(r.events.get(idA)!.title, "Mudado em outro lugar");
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.state, op.draft?.title, op.serverCopy?.version], ["conflict", "Minha edição", 3]);
  // Conflitos não são reenviados sozinhos.
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 0);
});

test("resolver conflito: manter o meu reenvia sobre a versão do servidor; usar o do servidor descarta o rascunho", async () => {
  const store = createMemoryCalendarStore();
  const base = server({ version: 1 });
  await store.putEvents(owner, [base]);
  const r = remote([server({ version: 3, title: "Servidor" })]);
  await enqueue(store, owner, { kind: "update", event: base, draft: draft({ title: "Meu" }) });
  await flushOutbox(store, r.api, owner, { force: true });
  await resolveConflict(store, owner, idA, "mine");
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.deepEqual([r.events.get(idA)!.title, r.events.get(idA)!.version], ["Meu", 4]);

  // Segundo caso: usar o do servidor.
  const store2 = createMemoryCalendarStore();
  await store2.putEvents(owner, [base]);
  const r2 = remote([server({ version: 3, title: "Servidor" })]);
  await enqueue(store2, owner, { kind: "update", event: base, draft: draft({ title: "Meu" }) });
  await flushOutbox(store2, r2.api, owner, { force: true });
  await resolveConflict(store2, owner, idA, "server");
  assert.deepEqual(await store2.listOps(owner), []);
  assert.equal((await store2.listEvents(owner))[0].title, "Servidor");
});

test("evento removido no servidor: editar vira conflito sem cópia; manter o meu recria com o mesmo ID", async () => {
  const store = createMemoryCalendarStore();
  const base = server();
  await store.putEvents(owner, [base]);
  const r = remote();
  await enqueue(store, owner, { kind: "update", event: base, draft: draft({ title: "Recriar" }) });
  await flushOutbox(store, r.api, owner, { force: true });
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.state, op.serverCopy], ["conflict", null]);
  await resolveConflict(store, owner, idA, "mine");
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.equal(r.events.get(idA)!.title, "Recriar");
});

test("mudanças seguidas se fundem: editar criação pendente continua criação e excluir cancela sem rede", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "v1" }) });
  const [created] = await store.listOps(owner);
  await enqueue(store, owner, { kind: "update", event: withOutbox([], [created])[0].event, draft: draft({ title: "v2" }) });
  const [merged] = await store.listOps(owner);
  assert.deepEqual([merged.kind, merged.draft?.title, merged.baseVersion, merged.rev], ["create", "v2", null, 2]);
  await enqueue(store, owner, { kind: "delete", event: withOutbox([], [merged])[0].event });
  assert.deepEqual(await store.listOps(owner), []);
  await flushOutbox(store, r.api, owner, { force: true });
  assert.deepEqual(r.calls, []);
});

test("excluir envia a versão lida; 404 conta como excluído; exclusão com versão velha é conflito", async () => {
  const store = createMemoryCalendarStore();
  const base = server({ version: 2 });
  await store.putEvents(owner, [base]);
  const r = remote([base]);
  await enqueue(store, owner, { kind: "delete", event: base });
  assert.equal(withOutbox(await store.listEvents(owner), await store.listOps(owner)).length, 0);
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.deepEqual(r.calls, [`remove:${idA}@2`]);
  assert.equal((await store.listEvents(owner)).length, 0);

  // Já excluído por outro dispositivo: 404 = objetivo cumprido.
  await store.putEvents(owner, [base]);
  await enqueue(store, owner, { kind: "delete", event: base });
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);

  // Alterado por outro dispositivo: conflito, o evento continua visível.
  const r2 = remote([server({ version: 5 })]);
  await store.putEvents(owner, [base]);
  await enqueue(store, owner, { kind: "delete", event: base });
  assert.equal((await flushOutbox(store, r2.api, owner, { force: true })).conflicts, 1);
  const shown = withOutbox(await store.listEvents(owner), await store.listOps(owner));
  assert.deepEqual(shown.map((item) => item.status), ["conflict"]);
});

test("400 do servidor marca o envio como recusado, mantém o rascunho e permite descartar", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "Ruim" }) });
  r.failures.push(http(400, "VALIDATION_ERROR"));
  const result = await flushOutbox(store, r.api, owner, { force: true });
  assert.equal(result.rejected, 1);
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.state, op.draft?.title, op.lastError], ["rejected", "Ruim", "VALIDATION_ERROR"]);
  assert.equal(withOutbox([], [op])[0].status, "rejected");
  await discardOp(store, owner, idA);
  assert.deepEqual(await store.listOps(owner), []);
});

test("401 interrompe a rodada sem marcar o envio; editar durante o envio não perde a edição nova", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  r.failures.push(http(401, "UNAUTHORIZED"));
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).stopped, "unauthorized");
  assert.deepEqual([(await store.getOp(owner, idA))!.state, (await store.getOp(owner, idA))!.attempts], ["pending", 0]);

  // Edição concorrente: o envio confirmado é da revisão 1, mas o usuário já gravou a revisão 2.
  const original = r.api.create;
  r.api.create = async (id, d) => { const saved = await original(id, d); await enqueue(store, owner, { kind: "update", event: saved, draft: draft({ title: "Editado durante o envio" }) }); return saved; };
  await flushOutbox(store, r.api, owner, { force: true });
  const op = (await store.getOp(owner, idA))!;
  assert.equal(op.draft?.title, "Editado durante o envio");
  assert.equal(op.rev, 2);
});

test("a fila é isolada por conta e a troca de conta no meio da rodada não grava nada", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  assert.deepEqual(await store.listOps("bob"), []);
  assert.equal((await flushOutbox(store, r.api, "bob", { force: true })).sent, 0);
  assert.equal(r.calls.length, 0);

  let current = true;
  const original = r.api.create;
  r.api.create = async (id, d) => { const saved = await original(id, d); current = false; return saved; };
  await flushOutbox(store, r.api, owner, { force: true, isCurrent: () => current });
  assert.equal((await store.listEvents(owner)).length, 0);
  assert.equal((await store.listOps(owner)).length, 1);

  await store.clearOwner(owner);
  assert.deepEqual(await store.listOps(owner), []);
});

test("draftOf copia só os campos editáveis", () => {
  const copy = draftOf(server({ links: [{ kind: "note", id: idA }] }));
  assert.deepEqual(Object.keys(copy).sort(), ["allDay", "description", "end", "links", "location", "start", "timeZone", "title"]);
});

/** Servidor cujo envio fica suspenso até `release`, para editar/excluir "durante o envio". */
function gated(r: ReturnType<typeof remote>, method: "create" | "update", outcome: "ok" | "network") {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const original = r.api[method] as (...args: never[]) => Promise<CalendarEventOutput>;
  (r.api as unknown as Record<string, unknown>)[method] = async (...args: never[]) => {
    if (outcome === "network") { await waiting; throw net(); }
    const saved = await original(...args);
    await waiting;
    return saved;
  };
  return release;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("regressão: envio em voo que falha por rede não desfaz a edição mais nova (compare-and-set por revisão)", async () => {
  const store = createMemoryCalendarStore();
  const base = server();
  await store.putEvents(owner, [base]);
  const r = remote([base]);
  await enqueue(store, owner, { kind: "update", event: base, draft: draft({ title: "original" }) });
  const healthy = r.api.update;
  const release = gated(r, "update", "network");
  const round = flushOutbox(store, r.api, owner, { force: true });
  await tick();
  await enqueue(store, owner, { kind: "update", event: base, draft: draft({ title: "texto novo" }) });
  release();
  await round;
  r.api.update = healthy; // a rede voltou
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.draft?.title, op.rev, op.attempts, op.lastError], ["texto novo", 2, 0, null]);
  // A edição nova segue para o servidor na próxima rodada.
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.equal(r.events.get(idA)!.title, "texto novo");
});

test("regressão: excluir uma criação já em voo vira lápide; o ACK não ressuscita o evento e o servidor acaba sem ele", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  const release = gated(r, "create", "ok");
  const round = flushOutbox(store, r.api, owner, { force: true });
  await tick();
  const created = withOutbox([], await store.listOps(owner))[0].event;
  await enqueue(store, owner, { kind: "delete", event: created });
  release();
  await round;
  // O ACK gravou o evento no cache, mas a lápide o esconde e segue pendente sobre a versão confirmada.
  const [tombstone] = await store.listOps(owner);
  assert.deepEqual([tombstone.kind, tombstone.baseVersion, tombstone.state], ["delete", 1, "pending"]);
  assert.equal(withOutbox(await store.listEvents(owner), [tombstone]).length, 0);
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.equal(r.events.size, 0);
  assert.deepEqual([(await store.listEvents(owner)).length, (await store.listOps(owner)).length], [0, 0]);
});

test("regressão: lápide sem versão consulta o servidor (404 = nunca chegou) e tolera criação cujo ACK se perdeu", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() });
  // O envio chegou ao servidor, mas a resposta se perdeu (sentAt gravado, op continua).
  const original = r.api.create;
  r.api.create = async (id, d) => { await original(id, d); throw net(); };
  await flushOutbox(store, r.api, owner, { force: true });
  assert.equal(r.events.size, 1);
  await enqueue(store, owner, { kind: "delete", event: withOutbox([], await store.listOps(owner))[0].event });
  assert.equal((await store.getOp(owner, idA))!.kind, "delete");
  assert.equal((await flushOutbox(store, r.api, owner, { force: true })).sent, 1);
  assert.equal(r.events.size, 0);

  // Criação que nunca saiu: cancelada sem rede e sem lápide.
  const fresh = createMemoryCalendarStore();
  await enqueue(fresh, owner, { kind: "create", eventId: idA, draft: draft() });
  await enqueue(fresh, owner, { kind: "delete", event: withOutbox([], await fresh.listOps(owner))[0].event });
  assert.deepEqual(await fresh.listOps(owner), []);
});

test("regressão: criação confirmada com edição nova em voo vira edição sobre a versão confirmada (sem conflito consigo mesma)", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "v1" }) });
  const release = gated(r, "create", "ok");
  const round = flushOutbox(store, r.api, owner, { force: true });
  await tick();
  await enqueue(store, owner, { kind: "update", event: withOutbox([], await store.listOps(owner))[0].event, draft: draft({ title: "v2" }) });
  release();
  await round;
  const [op] = await store.listOps(owner);
  assert.deepEqual([op.kind, op.baseVersion, op.draft?.title], ["update", 1, "v2"]);
  const next = await flushOutbox(store, r.api, owner, { force: true });
  assert.deepEqual([next.sent, next.conflicts], [1, 0]);
  assert.equal(r.events.get(idA)!.title, "v2");
});

test("regressão: Retry-After é piso — 600 s não vira 60 s e 'tentar agora' não o antecipa", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() }, 0);
  r.failures.push(http(429, "RATE_LIMITED", 600_000));
  await flushOutbox(store, r.api, owner, { now: () => 0 });
  const op = (await store.getOp(owner, idA))!;
  assert.deepEqual([op.notBefore, op.nextAttemptAt, op.state], [600_000, 600_000, "pending"]);

  const before = r.calls.length;
  const manual = await flushOutbox(store, r.api, owner, { now: () => 1, force: true });
  assert.deepEqual([r.calls.length, manual.sent + manual.failed], [before, 0]);
  assert.equal((await flushOutbox(store, r.api, owner, { now: () => 599_999, force: true })).sent, 0);
  // Depois do piso, o envio acontece (inclusive manual) e o rascunho continua intacto até lá.
  assert.equal((await flushOutbox(store, r.api, owner, { now: () => 600_000, force: true })).sent, 1);
});

test("Retry-After longo não é truncado e o piso sobrevive a nova edição do rascunho", async () => {
  const store = createMemoryCalendarStore();
  const r = remote();
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft() }, 0);
  r.failures.push(http(429, "RATE_LIMITED", 10 * 24 * 3_600_000));
  await flushOutbox(store, r.api, owner, { now: () => 0 });
  assert.equal((await store.getOp(owner, idA))!.notBefore, 10 * 24 * 3_600_000);
  await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "editado" }) }, 1_000);
  assert.equal((await store.getOp(owner, idA))!.notBefore, 10 * 24 * 3_600_000);
  assert.equal((await flushOutbox(store, r.api, owner, { now: () => 2_000, force: true })).sent, 0);
});

for (const adapter of ["memory", "indexeddb"] as const) {
  test(`429 durante edição preserva o texto e o piso do servidor (${adapter})`, async () => {
    const store = adapter === "memory" ? createMemoryCalendarStore() : createIndexedDbCalendarStore(new IDBFactory());
    const r = remote();
    await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "v1" }) }, 0);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sending = new Promise<void>(resolve => { started = resolve; });
    const healthy = r.api.create;
    r.api.create = async () => { started(); await gate; throw http(429, "RATE_LIMITED", 600_000); };
    const round = flushOutbox(store, r.api, owner, { now: () => 0 });
    await sending;
    await enqueue(store, owner, { kind: "create", eventId: idA, draft: draft({ title: "v2" }) }, 1);
    const stale = (await store.getOp(owner, idA))!;
    release(); await round;
    let op = (await store.getOp(owner, idA))!;
    assert.deepEqual([op.draft?.title, op.rev, op.notBefore], ["v2", 2, 600_000]);
    // Uma edição que leu antes do 429 também não pode apagar o prazo na gravação.
    await store.putOp({ ...stale, rev: 3, draft: draft({ title: "v3" }) });
    op = (await store.getOp(owner, idA))!;
    assert.deepEqual([op.draft?.title, op.notBefore], ["v3", 600_000]);
    r.api.create = healthy;
    assert.equal((await flushOutbox(store, r.api, owner, { now: () => 599_999, force: true })).sent, 0);
    assert.equal(r.events.size, 0);
    assert.equal((await flushOutbox(store, r.api, owner, { now: () => 600_000, force: true })).sent, 1);
    assert.equal(r.events.get(idA)!.title, "v3");
    assert.equal((await store.listOps(owner)).length, 0);
  });
}

test("replay não conclui conteúdo local igual enquanto a cópia Google está atrasada", async () => {
  for (const explicit of [false, true]) {
    const store = createMemoryCalendarStore();
    const event = server({ version: 2, reflection: { reflectedAt: iso, inSync: false, state: "linked" } });
    const r = remote([event]);
    await enqueue(store, owner, { kind: "update", event: { ...event, version: 1 }, draft: draft({ ...(explicit ? { sendToGoogle: true } : {}) }) });
    r.failures.push(http(409, "INTEGRATION_NOT_CONNECTED"));
    await flushOutbox(store, r.api, owner);
    assert.equal((await store.getOp(owner, idA))?.state, "conflict");
  }
});

test("GOOGLE_CONFLICT mantém intenção mesmo se cache local já tiver o mesmo conteúdo", async () => {
  const store = createMemoryCalendarStore(); const event = server(); const r = remote([event]);
  await enqueue(store, owner, { kind: "update", event, draft: draft() });
  r.failures.push(http(409, "GOOGLE_CONFLICT"));
  await flushOutbox(store, r.api, owner);
  assert.equal((await store.getOp(owner, idA))?.lastError, "GOOGLE_CONFLICT");
});

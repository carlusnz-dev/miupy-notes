import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput, EventDraft } from "../lib/calendar-api";
import { discardOp, draftOf, enqueue, flushOutbox, resolveConflict, sameContent, withOutbox, type CalendarRemote } from "./outbox.js";
import { createMemoryCalendarStore } from "./store.js";

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

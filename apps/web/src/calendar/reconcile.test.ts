import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput, EventDraft } from "../lib/calendar-api";
import { enqueue, flushOutbox, type CalendarRemote } from "./outbox.js";
import { reconcileRange } from "./reconcile.js";
import { createMemoryCalendarStore } from "./store.js";

const owner = "alice";
const id = "00000000-0000-4000-8000-00000000000a";
const iso = "2026-10-21T12:00:00.000Z";
const draft: EventDraft = { title: "t", description: "", location: "", allDay: false, start: iso, end: "2026-10-21T13:00:00.000Z", timeZone: "UTC", links: [] };
const event = (extra: Partial<CalendarEventOutput> = {}): CalendarEventOutput => ({ id, ...draft, source: "local", readOnly: false, external: null, reflection: null, createdAt: iso, updatedAt: iso, version: 1, ...extra });
const range = { from: "2026-10-21T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z" };
const signal = () => new AbortController().signal;

function gate<T>(value: T) {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { release, resolve: async () => { await waiting; return value; } };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const writer = (): CalendarRemote => ({ create: async (eventId, d) => event({ id: eventId, ...d }), update: async () => event(), remove: async () => {}, get: async () => event() });

test("regressão: leitura iniciada antes do ACK de uma criação não apaga o evento confirmado depois", async () => {
  const store = createMemoryCalendarStore();
  const slow = gate<CalendarEventOutput[]>([]);
  const loading = reconcileRange(store, { listRange: slow.resolve }, owner, range, signal());
  await tick();
  await enqueue(store, owner, { kind: "create", eventId: id, draft });
  await flushOutbox(store, writer(), owner, { force: true });
  assert.equal((await store.listEvents(owner)).length, 1);
  slow.release();
  assert.equal(await loading, "changed");
  assert.equal((await store.listEvents(owner)).length, 1);
});

test("regressão: leitura velha não desfaz a versão confirmada nem ressuscita evento excluído", async () => {
  const store = createMemoryCalendarStore();
  await store.putEvents(owner, [event({ version: 1 })]);
  const stale = gate([event({ version: 1, title: "antigo" })]);
  const loading = reconcileRange(store, { listRange: stale.resolve }, owner, range, signal());
  await tick();
  const remote: CalendarRemote = { ...writer(), remove: async () => {} };
  await enqueue(store, owner, { kind: "delete", event: event() });
  await flushOutbox(store, remote, owner, { force: true });
  assert.equal((await store.listEvents(owner)).length, 0);
  stale.release();
  assert.equal(await loading, "changed");
  assert.equal((await store.listEvents(owner)).length, 0);
});

test("sem mudança local durante a leitura: atualiza, remove o que sumiu e preserva o que tem envio pendente", async () => {
  const store = createMemoryCalendarStore();
  const other = "00000000-0000-4000-8000-00000000000b";
  const pendingId = "00000000-0000-4000-8000-00000000000c";
  await store.putEvents(owner, [event({ id: other }), event({ id: pendingId })]);
  await enqueue(store, owner, { kind: "update", event: event({ id: pendingId }), draft: { ...draft, title: "pendente" } });
  const result = await reconcileRange(store, { listRange: async () => [event({ title: "do servidor", version: 2 })] }, owner, range, signal());
  assert.equal(result, "ok");
  const ids = (await store.listEvents(owner)).map((item) => item.id).sort();
  assert.deepEqual(ids, [id, pendingId].sort());
  assert.equal((await store.listEvents(owner)).find((item) => item.id === id)!.title, "do servidor");
});

test("leitura abortada não grava nada", async () => {
  const store = createMemoryCalendarStore();
  const controller = new AbortController();
  const result = await reconcileRange(store, { listRange: async () => { controller.abort(); return [event()]; } }, owner, range, controller.signal);
  assert.equal(result, "aborted");
  assert.equal((await store.listEvents(owner)).length, 0);
});

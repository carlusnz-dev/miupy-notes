import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { calendarStore, clearCalendarOwner, trackCalendarWork } from "./session";
import { calendarFetchCache } from "./fetch-cache";
import { clearUserLocalStorage } from "../lib/user-cache-cleanup";
import { enqueue } from "./outbox";

const draft = { title: "Sintético", description: "", location: "", allDay: true, start: "2026-10-27", end: "2026-10-28", timeZone: null, links: [] };
test("logout apaga eventos, meta, outbox e memória só da conta, após gravações em voo", async () => {
  await calendarStore.putEvents('alice', [{ ...draft, id: 'cached', source: 'local', readOnly: false, external: null, reflection: null, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z', version: 1 }]);
  await calendarStore.setMeta('alice', 'lastFetchedAt', '1');
  await calendarStore.setMeta('bob', 'lastFetchedAt', '2');
  await enqueue(calendarStore, 'alice', { kind: 'create', eventId: 'event', draft });
  calendarFetchCache.mark('alice', 'range');
  calendarFetchCache.remember('alice', 'notes', ['secret']);
  calendarFetchCache.saveView('alice', 'day', { year: 2026, month: 10, day: 27 });
  let release!: () => void;
  trackCalendarWork(new Promise<void>(r => { release = r; }).then(() => calendarStore.setMeta('alice', 'late', 'secret')));
  const clearing = clearCalendarOwner('alice');
  release();
  await clearing;
  assert.deepEqual(await calendarStore.listOps('alice'), []);
  assert.deepEqual(await calendarStore.listEvents('alice'), []);
  assert.equal(await calendarStore.getMeta('alice', 'lastFetchedAt'), null);
  assert.equal(await calendarStore.getMeta('alice', 'late'), null);
  assert.equal(await calendarStore.getMeta('bob', 'lastFetchedAt'), '2');
  assert.equal(calendarFetchCache.recall('alice', 'notes'), undefined);
  assert.equal(calendarFetchCache.freshAt('alice', 'range'), null);
  assert.equal(calendarFetchCache.lastView('alice'), null);
});

test("limpeza local remove chaves da aplicação e informa falha de armazenamento", () => {
  const values = new Map([['miupy-calendar.events.alice', 'secret'], ['miupy.notes-tree.collapsed.v1', 'id'], ['other-app', 'keep']]);
  const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i], removeItem: (key: string) => { values.delete(key); } } as Storage;
  clearUserLocalStorage(storage);
  assert.deepEqual([...values.keys()], ['other-app']);
  assert.throws(() => clearUserLocalStorage({ get length() { throw new Error('blocked'); } } as Storage));
});

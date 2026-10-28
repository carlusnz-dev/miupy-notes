import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map<string, string>();
Object.assign(globalThis, {
  isTauri: true,
  window: { isTauri: true, __TAURI_INTERNALS__: { invoke: async (cmd: string) => {
    if (cmd === 'auth_status') return { signedIn: true };
    if (cmd === 'auth_id_token') return 'synthetic.' + btoa(JSON.stringify({ sub: 'alice' })) + '.synthetic';
    return null;
  } }, addEventListener() {} },
  localStorage: { get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i], getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => { storage.delete(key); } },
});

test("saída central confirma pendências da agenda, limpa todos os caches e informa falhas", { timeout: 5000 }, async () => {
  const auth = await import('./auth');
  const { calendarStore } = await import('../calendar/session');
  const { enqueue } = await import('../calendar/outbox');
  const { queryClient } = await import('./query-client');
  await auth.initAuth();
  queryClient.setQueryData(['private'], { secret: 'synthetic' });
  await calendarStore.setMeta('alice', 'lastFetchedAt', '1');
  await enqueue(calendarStore, 'alice', { kind: 'create', eventId: 'event', draft: { title: 'Sintético', description: '', location: '', allDay: true, start: '2026-10-27', end: '2026-10-28', timeZone: null, links: [] } });
  storage.set('miupy-calendar.alice', 'synthetic');
  assert.deepEqual(await auth.signOut(), { status: 'needs-confirmation', unsynced: 1 });
  assert.equal((await calendarStore.listOps('alice')).length, 1);
  const result = await auth.signOut({ discardDrafts: true });
  assert.equal(result.status, 'signed-out');
  if (result.status === 'signed-out') assert.deepEqual(result.cleanupErrors, []);
  assert.deepEqual(await calendarStore.listOps('alice'), []);
  assert.equal(await calendarStore.getMeta('alice', 'lastFetchedAt'), null);
  assert.equal(queryClient.getQueryData(['private']), undefined);
  assert.equal(storage.size, 0);
  await auth.signIn();
  const clear = calendarStore.clearOwner;
  calendarStore.clearOwner = async () => { throw new Error('blocked'); };
  const failed = await auth.signOut({ discardDrafts: true });
  assert.equal(failed.status, 'signed-out');
  if (failed.status === 'signed-out') assert.ok(failed.cleanupErrors.some(message => message.includes('agenda')));
  calendarStore.clearOwner = clear;
});

test("expiração por 401 suspende e preserva os envios pendentes", async () => {
  const auth = await import('./auth');
  const { calendarStore } = await import('../calendar/session');
  const { enqueue } = await import('../calendar/outbox');
  await auth.signIn();
  await enqueue(calendarStore, 'alice', { kind: 'create', eventId: 'preserved', draft: { title: 'Sintético', description: '', location: '', allDay: true, start: '2026-10-27', end: '2026-10-28', timeZone: null, links: [] } });
  auth.expireSession();
  assert.equal((await calendarStore.listOps('alice')).length, 1);
});

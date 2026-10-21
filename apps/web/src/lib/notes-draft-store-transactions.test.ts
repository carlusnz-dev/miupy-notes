import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { createIndexedDbDraftStore } from "./notes-draft-store-idb";
import type { DraftRecord } from "./notes-draft-store";
import { harness, note, text } from "./notes-test-kit";

globalThis.IDBKeyRange = IDBKeyRange;
const record = (body: string, writeId = body, ownerId = "u1"): DraftRecord => ({
  ownerId, noteId: "a", base: note("a"), draft: text("Nota a", body), eol: "\n", revision: 1, writeId, savedAt: 0,
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error);
});
const opened = (req: IDBOpenDBRequest) => new Promise<IDBDatabase>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Aborta a remoção, depois que a intenção já foi confirmada em outra transação. */
function abortCleanup() {
  const remove = IDBObjectStore.prototype.delete;
  return mock.method(IDBObjectStore.prototype, "delete", function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    const result = remove.call(this, key);
    if (this.name === "drafts" && this.transaction.objectStoreNames.contains("cleanups")) this.transaction.abort();
    return result;
  });
}

test("IndexedDB: duas escritas CAS concorrentes e ACK com revisão igual preservam a vencedora", async () => {
  const factory = new IDBFactory();
  const a = createIndexedDbDraftStore(factory);
  const b = createIndexedDbDraftStore(factory);
  const first = record("primeira");
  const second = record("segunda");
  const writes = await Promise.allSettled([a.put(first, null), b.put(second, null)]);
  assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
  const winner = (await a.get("u1", "a"))!;
  const loser = winner.writeId === first.writeId ? second : first;
  await assert.rejects(b.remove("u1", "a", 1, loser), { code: "LOCAL_DRAFT_CONFLICT" });
  assert.deepEqual(await a.get("u1", "a"), winner);
  await a.remove("u1", "a", 1, winner);
  assert.equal(await a.get("u1", "a"), null);
});

test("IndexedDB: migração v1 preserva corpo, EOL e revisão legados e acrescenta journal", async () => {
  const factory = new IDBFactory();
  const req = factory.open("miupy-notes-drafts", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("drafts", { keyPath: ["ownerId", "noteId"] }).createIndex("owner", "ownerId");
  const legacyDb = await opened(req);
  const legacy = record("linha\r\nseguinte");
  delete legacy.writeId;
  legacy.eol = "\r\n";
  const tx = legacyDb.transaction("drafts", "readwrite");
  tx.objectStore("drafts").put(legacy);
  await completed(tx);
  legacyDb.close();
  const store = createIndexedDbDraftStore(factory);
  assert.deepEqual(await store.get("u1", "a"), legacy);
  const next = { ...legacy, revision: 2, writeId: "nova-escrita" };
  await store.put(next, { revision: 1 });
  assert.deepEqual(await store.listByOwner("u1"), [next]);
});

for (const scope of ["conta", "nota"] as const) {
  test(`IndexedDB: intenção de descarte da ${scope} sobrevive a aborto e nova fila`, async () => {
    const factory = new IDBFactory();
    const store = createIndexedDbDraftStore(factory);
    await store.put(record("descartar"));
    await store.put(record("outra conta", "u2-write", "u2"));
    const h = harness({ store });
    await h.open();
    const abort = abortCleanup();
    try {
      if (scope === "conta") assert.equal((await h.queue.closeSession({ purge: true })).purged, false);
      else assert.equal(await h.queue.discard("a"), false);
    } finally { abort.mock.restore(); }
    // Nova instância não compartilha as pendências em memória da fila/adaptador anterior.
    const restarted = harness({ store: createIndexedDbDraftStore(factory) });
    await restarted.open();
    assert.equal(restarted.queue.view("a")?.snapshot, null);
    assert.equal(await store.get("u1", "a"), null);
    assert.equal((await store.get("u2", "a"))?.draft.body, "outra conta");
    await restarted.clock.advance(2000);
    assert.equal(restarted.calls.length, 0);
  });
}

test("IndexedDB: falha ao gravar a própria intenção rejeita descarte e preserva o rascunho", async () => {
  const factory = new IDBFactory();
  const store = createIndexedDbDraftStore(factory);
  const original = record("continua recuperável");
  await store.put(original);
  const put = IDBObjectStore.prototype.put;
  const abort = mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const result = put.call(this, value, key);
    if (this.name === "cleanups") this.transaction.abort();
    return result;
  });
  try { await assert.rejects(store.clearOwner("u1")); }
  finally { abort.mock.restore(); }
  const restarted = createIndexedDbDraftStore(factory);
  assert.deepEqual(await restarted.get("u1", "a"), original);
});

test("IndexedDB com duas filas: colisão mantém snapshots e bloqueia PATCH da fila sem proteção", async () => {
  const factory = new IDBFactory();
  const first = harness({ store: createIndexedDbDraftStore(factory) });
  const second = harness({ store: createIndexedDbDraftStore(factory) });
  await first.open();
  await second.open();
  first.queue.edit("a", text("Nota a", "primeira"), "\n");
  assert.equal(await first.queue.protect("a"), true);
  second.queue.edit("a", text("Nota a", "segunda"), "\n");
  assert.equal(await second.queue.protect("a"), false);
  await second.clock.advance(2000);
  assert.equal(second.calls.length, 0);
  assert.equal(second.queue.view("a")?.snapshot?.draft.body, "segunda");
  assert.equal((await first.store.get("u1", "a"))?.draft.body, "primeira");
  first.queue.suspend();
  second.queue.suspend();
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createIndexedDbDraftStore } from "./notes-draft-store-idb";

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  constructor(readonly script: (tx: FakeTx, request: FakeRequest) => void, readonly journal = false) {}
  objectStore() {
    const tx = this;
    const make = () => { const request = new FakeRequest(); queueMicrotask(() => {
      if (tx.journal) { request.result = []; request.onsuccess?.(); tx.oncomplete?.(); }
      else tx.script(tx, request);
    }); return request; };
    return { get: make, put: make, delete: make, index: () => ({ getAll: make }) };
  }
}
class FakeRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: unknown = undefined;
  error: Error | null = null;
}
/** Fábrica falsa: o `script` decide como a transação termina (sucesso, aborto após sucesso, erro de cota). */
function factory(script: (tx: FakeTx, request: FakeRequest) => void): IDBFactory {
  return {
    open() {
      const req: { onupgradeneeded?: () => void; onsuccess?: () => void; result?: unknown; error?: unknown } = {};
      queueMicrotask(() => {
        req.result = { transaction: (stores: string[]) => new FakeTx(script, stores.includes("cleanups")), objectStoreNames: { contains: () => false }, createObjectStore: () => ({ createIndex: () => undefined }) };
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

const rejections: unknown[] = [];
process.on("unhandledRejection", (reason) => rejections.push(reason));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test("leitura cujo request teve sucesso mas a transação abortou rejeita, sem rejeição não tratada", async () => {
  const store = createIndexedDbDraftStore(factory((tx, request) => {
    request.result = { revision: 1 };
    request.onsuccess?.();
    tx.error = new Error("aborto");
    tx.onabort?.();
  }));
  await assert.rejects(store.get("u1", "a"), /aborto/);
  await assert.rejects(store.listByOwner("u1"), /aborto/);
  await tick();
  assert.deepEqual(rejections, []);
});

test("erro do request seguido de aborto rejeita uma vez e sem rejeição não tratada", async () => {
  const store = createIndexedDbDraftStore(factory((tx, request) => {
    request.error = new Error("QuotaExceededError");
    request.onerror?.();
    tx.error = request.error;
    tx.onabort?.();
  }));
  await assert.rejects(store.put({ ownerId: "u1", noteId: "a" } as never), /Quota/);
  await assert.rejects(store.get("u1", "a"), /Quota/);
  await tick();
  assert.deepEqual(rejections, []);
});

test("escrita só resolve quando a transação completa", async () => {
  let complete = () => undefined as void;
  const store = createIndexedDbDraftStore(factory((tx) => { complete = () => tx.oncomplete?.(); }));
  let done = false;
  const writing = store.put({ ownerId: "u1", noteId: "a" } as never).then(() => { done = true; });
  await tick();
  assert.equal(done, false);
  complete();
  await writing;
  assert.equal(done, true);
});

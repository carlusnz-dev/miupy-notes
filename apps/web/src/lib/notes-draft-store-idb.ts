import { createUnavailableDraftStore, localDraftConflict, matchesDraftVersion, type DraftRecord, type DraftStore } from "./notes-draft-store";

const DB_NAME = "miupy-notes-drafts";
const STORE = "drafts";
const CLEANUPS = "cleanups";
type Cleanup = { ownerId: string; noteId: string }; // noteId vazio representa a conta inteira.

const request = <T,>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("Falha no armazenamento local."));
});

/** Termina quando a transação confirma (durabilidade), não quando o pedido é aceito. */
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error("Falha no armazenamento local."));
  tx.onabort = () => reject(tx.error ?? new Error("Gravação local cancelada."));
});

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 2);
    let blocked = false;
    req.onupgradeneeded = () => {
      // Migração preserva os rascunhos v1 e só acrescenta o journal.
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: ["ownerId", "noteId"] });
        store.createIndex("owner", "ownerId");
      }
      if (!req.result.objectStoreNames.contains(CLEANUPS)) {
        const journal = req.result.createObjectStore(CLEANUPS, { keyPath: ["ownerId", "noteId"] });
        journal.createIndex("owner", "ownerId");
      }
    };
    req.onsuccess = () => {
      const handle = req.result;
      if (blocked) { handle.close(); return; }
      handle.onversionchange = () => handle.close();
      resolve(handle);
    };
    req.onerror = () => reject(req.error ?? new Error("Não foi possível abrir o armazenamento local."));
    req.onblocked = () => { blocked = true; reject(new Error("Armazenamento local bloqueado por outra janela.")); };
  });
}

/** IndexedDB no perfil do WebView, sem criptografia própria nem reserva silenciosa em memória. */
export function createIndexedDbDraftStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): DraftStore {
  if (!factory) return createUnavailableDraftStore();
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= open(factory).then((handle) => {
      handle.onversionchange = () => { handle.close(); opened = null; };
      return handle;
    }).catch((error) => { opened = null; throw error; });
    return opened;
  };
  async function tx(mode: IDBTransactionMode, stores = [STORE]) {
    const handle = await db();
    let transaction: IDBTransaction;
    try { transaction = handle.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined); } catch { transaction = handle.transaction(stores, mode); }
    const finished = done(transaction);
    finished.catch(() => undefined);
    return { transaction, store: transaction.objectStore(STORE), finished };
  }
  const ownerRange = (ownerId: string) => IDBKeyRange.bound([ownerId, ""], [ownerId, "￿"]);

  async function replay(ownerId: string) {
    const { transaction, store, finished } = await tx("readwrite", [STORE, CLEANUPS]);
    const journal = transaction.objectStore(CLEANUPS);
    const read = journal.index("owner").getAll(ownerId);
    read.onsuccess = () => {
      for (const item of read.result as Cleanup[]) {
        store.delete(item.noteId ? [ownerId, item.noteId] : ownerRange(ownerId));
        journal.delete([ownerId, item.noteId]);
      }
    };
    await finished;
  }

  async function discard(ownerId: string, noteId: string) {
    // Confirma a intenção ANTES da remoção. Se a segunda transação abortar, replay a repete após restart.
    const { transaction, finished } = await tx("readwrite", [STORE, CLEANUPS]);
    transaction.objectStore(CLEANUPS).put({ ownerId, noteId } satisfies Cleanup);
    await finished;
    await replay(ownerId);
  }

  return {
    async put(record, expected) {
      await replay(record.ownerId);
      const { store, finished } = await tx("readwrite");
      const read = store.get([record.ownerId, record.noteId]);
      let conflict = false;
      read.onsuccess = () => {
        conflict = !matchesDraftVersion(read.result as DraftRecord | undefined, expected);
        if (!conflict) store.put(record);
      };
      await finished;
      if (conflict) throw localDraftConflict();
    },
    async get(ownerId, noteId) {
      await replay(ownerId);
      const { store, finished } = await tx("readonly");
      const [found] = await Promise.all([request(store.get([ownerId, noteId])), finished]);
      return (found as DraftRecord | undefined) ?? null;
    },
    async listByOwner(ownerId) {
      await replay(ownerId);
      const { store, finished } = await tx("readonly");
      const [records] = await Promise.all([request(store.index("owner").getAll(ownerId)), finished]);
      return records as DraftRecord[];
    },
    async remove(ownerId, noteId, upToRevision, expected) {
      if (upToRevision === undefined && expected === undefined) return discard(ownerId, noteId);
      const { store, finished } = await tx("readwrite");
      const read = store.get([ownerId, noteId]);
      let conflict = false;
      read.onsuccess = () => {
        const stored = read.result as DraftRecord | undefined;
        conflict = !matchesDraftVersion(stored, expected);
        if (!conflict && stored && (upToRevision === undefined || stored.revision <= upToRevision)) store.delete([ownerId, noteId]);
      };
      await finished;
      if (conflict) throw localDraftConflict();
    },
    clearOwner: (ownerId) => discard(ownerId, ""),
  };
}

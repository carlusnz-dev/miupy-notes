import { createUnavailableDraftStore, type DraftRecord, type DraftStore } from "./notes-draft-store";

const DB_NAME = "miupy-notes-drafts";
const STORE = "drafts";

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
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      // Chave composta [ownerId, noteId]; o índice por dono permite listar e limpar uma conta só.
      const store = req.result.createObjectStore(STORE, { keyPath: ["ownerId", "noteId"] });
      store.createIndex("owner", "ownerId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Não foi possível abrir o armazenamento local."));
    req.onblocked = () => reject(new Error("Armazenamento local bloqueado por outra janela."));
  });
}

/**
 * Adaptador IndexedDB (WebView do Tauri e navegador). Sem dependência extra e sem criptografia própria:
 * o dado fica no perfil do WebView do usuário do sistema, protegido apenas pelas permissões do SO.
 * Falha ao abrir o banco derruba só as escritas (cada chamada reabre), nunca vira armazenamento falso.
 */
export function createIndexedDbDraftStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): DraftStore {
  if (!factory) return createUnavailableDraftStore();
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= open(factory).catch((error) => { opened = null; throw error; });
    return opened;
  };
  async function tx(mode: IDBTransactionMode) {
    const handle = await db();
    // `durability: "strict"` pede flush ao disco antes de `complete`; WebViews que não conhecem a opção a ignoram.
    let transaction: IDBTransaction;
    try { transaction = handle.transaction(STORE, mode, mode === "readwrite" ? { durability: "strict" } : undefined); } catch { transaction = handle.transaction(STORE, mode); }
    const finished = done(transaction);
    // Quem lança antes de aguardar `finished` (ex.: DataCloneError, cota) não deixa uma rejeição sem tratador.
    finished.catch(() => undefined);
    return { store: transaction.objectStore(STORE), finished };
  }
  return {
    async put(record) {
      const { store, finished } = await tx("readwrite");
      store.put(record);
      await finished;
    },
    async get(ownerId, noteId) {
      const { store, finished } = await tx("readonly");
      const read = store.get([ownerId, noteId]);
      // Request e transação são observados juntos: aborto depois do sucesso do request também rejeita a leitura.
      const [found] = await Promise.all([request(read), finished]);
      return (found as DraftRecord | undefined) ?? null;
    },
    async listByOwner(ownerId) {
      const { store, finished } = await tx("readonly");
      const [records] = await Promise.all([request(store.index("owner").getAll(ownerId)), finished]);
      return records as DraftRecord[];
    },
    async remove(ownerId, noteId, upToRevision) {
      const { store, finished } = await tx("readwrite");
      if (upToRevision === undefined) store.delete([ownerId, noteId]);
      else {
        // Leitura e remoção na mesma transação: uma edição mais nova que a confirmada não é apagada.
        const read = store.get([ownerId, noteId]);
        read.onsuccess = () => { if (((read.result as DraftRecord | undefined)?.revision ?? Infinity) <= upToRevision) store.delete([ownerId, noteId]); };
      }
      await finished;
    },
    async clearOwner(ownerId) {
      const { store, finished } = await tx("readwrite");
      store.delete(IDBKeyRange.bound([ownerId, ""], [ownerId, "￿"]));
      await finished;
    },
  };
}

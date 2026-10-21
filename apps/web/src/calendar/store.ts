import type { CalendarEventOutput, EventDraft } from "../lib/calendar-api";

/**
 * Envio pendente de UM evento (no máximo um por evento: mudanças seguidas se fundem em `outbox.ts`).
 * `rev` conta as edições locais: a confirmação do servidor só remove o registro da mesma revisão.
 */
export type OutboxOp = {
  ownerId: string;
  eventId: string;
  kind: "create" | "update" | "delete";
  /** Estado desejado (nulo em `delete`). Nunca é apagado por erro: é o rascunho do usuário. */
  draft: EventDraft | null;
  /** Versão do servidor sobre a qual o rascunho foi escrito (nulo em `create`). */
  baseVersion: number | null;
  state: "pending" | "conflict" | "rejected";
  rev: number;
  attempts: number;
  nextAttemptAt: number;
  /** Código público do último erro (`NETWORK_ERROR`, `CONFLICT`...), sem texto do servidor. */
  lastError: string | null;
  /** Cópia do servidor que causou o conflito; nula quando o evento foi removido lá. */
  serverCopy: CalendarEventOutput | null;
  createdAt: number;
  updatedAt: number;
};

/** Cache de eventos e fila de envio, isolados por conta (`ownerId`). Não guarda tokens. `put*` só resolve depois de gravado. */
export interface CalendarStore {
  putEvents(ownerId: string, events: readonly CalendarEventOutput[]): Promise<void>;
  removeEvents(ownerId: string, ids: readonly string[]): Promise<void>;
  listEvents(ownerId: string): Promise<CalendarEventOutput[]>;
  getMeta(ownerId: string, key: string): Promise<string | null>;
  setMeta(ownerId: string, key: string, value: string): Promise<void>;
  putOp(op: OutboxOp): Promise<void>;
  getOp(ownerId: string, eventId: string): Promise<OutboxOp | null>;
  listOps(ownerId: string): Promise<OutboxOp[]>;
  /** Remove o envio; com `upToRev`, só se a revisão gravada não for mais nova (edição durante o envio não se perde). */
  removeOp(ownerId: string, eventId: string, upToRev?: number): Promise<void>;
  clearOwner(ownerId: string): Promise<void>;
}

const copy = <T,>(value: T): T => structuredClone(value);
const key = (ownerId: string, id: string) => `${ownerId}\u0000${id}`;

/** Em memória: testes e falhas injetáveis. Não é durável e nunca serve de reserva silenciosa. */
export function createMemoryCalendarStore(): CalendarStore & { failNextPut: (error: Error) => void } {
  const events = new Map<string, CalendarEventOutput & { ownerId: string }>();
  const ops = new Map<string, OutboxOp>();
  const meta = new Map<string, string>();
  let failure: Error | null = null;
  const guard = () => { if (failure) { const error = failure; failure = null; throw error; } };
  return {
    failNextPut(error) { failure = error; },
    async putEvents(ownerId, items) { guard(); for (const item of items) events.set(key(ownerId, item.id), { ...copy(item), ownerId }); },
    async removeEvents(ownerId, ids) { for (const id of ids) events.delete(key(ownerId, id)); },
    async listEvents(ownerId) { return [...events.values()].filter((item) => item.ownerId === ownerId).map(({ ownerId: _owner, ...event }) => copy(event)); },
    async getMeta(ownerId, name) { return meta.get(key(ownerId, name)) ?? null; },
    async setMeta(ownerId, name, value) { meta.set(key(ownerId, name), value); },
    async putOp(op) { guard(); ops.set(key(op.ownerId, op.eventId), copy(op)); },
    async getOp(ownerId, eventId) { const found = ops.get(key(ownerId, eventId)); return found ? copy(found) : null; },
    async listOps(ownerId) { return [...ops.values()].filter((op) => op.ownerId === ownerId).map(copy).sort((a, b) => a.createdAt - b.createdAt); },
    async removeOp(ownerId, eventId, upToRev) {
      const stored = ops.get(key(ownerId, eventId));
      if (stored && (upToRev === undefined || stored.rev <= upToRev)) ops.delete(key(ownerId, eventId));
    },
    async clearOwner(ownerId) {
      for (const [k, v] of events) if (v.ownerId === ownerId) events.delete(k);
      for (const [k, v] of ops) if (v.ownerId === ownerId) ops.delete(k);
      for (const k of meta.keys()) if (k.startsWith(`${ownerId}\u0000`)) meta.delete(k);
    },
  };
}

export function createUnavailableCalendarStore(reason = "Armazenamento local indisponível."): CalendarStore {
  const fail = () => Promise.reject(new Error(reason));
  return { putEvents: fail, removeEvents: fail, listEvents: () => Promise.resolve([]), getMeta: () => Promise.resolve(null), setMeta: fail, putOp: fail, getOp: () => Promise.resolve(null), listOps: () => Promise.resolve([]), removeOp: fail, clearOwner: fail };
}

const DB_NAME = "miupy-calendar";
const request = <T,>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("Falha no armazenamento local."));
});
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error("Falha no armazenamento local."));
  tx.onabort = () => reject(tx.error ?? new Error("Gravação local cancelada."));
});

/**
 * Adaptador IndexedDB (WebView do Tauri e navegador). Sem criptografia própria: o dado fica no perfil do WebView do
 * usuário do sistema, como os rascunhos de notas. Cada chamada reabre o banco se a abertura falhou antes.
 */
export function createIndexedDbCalendarStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): CalendarStore {
  if (!factory) return createUnavailableCalendarStore();
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("events", { keyPath: ["ownerId", "id"] }).createIndex("owner", "ownerId");
      db.createObjectStore("outbox", { keyPath: ["ownerId", "eventId"] }).createIndex("owner", "ownerId");
      db.createObjectStore("meta", { keyPath: ["ownerId", "key"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Não foi possível abrir o armazenamento local."));
    req.onblocked = () => reject(new Error("Armazenamento local bloqueado por outra janela."));
  });
  const db = () => { opened ??= open().catch((error) => { opened = null; throw error; }); return opened; };
  async function tx(stores: string[], mode: IDBTransactionMode) {
    const handle = await db();
    let transaction: IDBTransaction;
    try { transaction = handle.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined); } catch { transaction = handle.transaction(stores, mode); }
    const finished = done(transaction);
    finished.catch(() => undefined);
    return { t: transaction, finished };
  }
  const ownerRange = (ownerId: string) => IDBKeyRange.bound([ownerId, ""], [ownerId, "￿"]);
  return {
    async putEvents(ownerId, items) {
      const { t, finished } = await tx(["events"], "readwrite");
      for (const item of items) t.objectStore("events").put({ ...item, ownerId });
      await finished;
    },
    async removeEvents(ownerId, ids) {
      const { t, finished } = await tx(["events"], "readwrite");
      for (const id of ids) t.objectStore("events").delete([ownerId, id]);
      await finished;
    },
    async listEvents(ownerId) {
      const { t, finished } = await tx(["events"], "readonly");
      const [rows] = await Promise.all([request(t.objectStore("events").index("owner").getAll(ownerId)), finished]);
      return (rows as Array<CalendarEventOutput & { ownerId: string }>).map(({ ownerId: _owner, ...event }) => event);
    },
    async getMeta(ownerId, name) {
      const { t, finished } = await tx(["meta"], "readonly");
      const [row] = await Promise.all([request(t.objectStore("meta").get([ownerId, name])), finished]);
      return (row as { value: string } | undefined)?.value ?? null;
    },
    async setMeta(ownerId, name, value) {
      const { t, finished } = await tx(["meta"], "readwrite");
      t.objectStore("meta").put({ ownerId, key: name, value });
      await finished;
    },
    async putOp(op) {
      const { t, finished } = await tx(["outbox"], "readwrite");
      t.objectStore("outbox").put(op);
      await finished;
    },
    async getOp(ownerId, eventId) {
      const { t, finished } = await tx(["outbox"], "readonly");
      const [row] = await Promise.all([request(t.objectStore("outbox").get([ownerId, eventId])), finished]);
      return (row as OutboxOp | undefined) ?? null;
    },
    async listOps(ownerId) {
      const { t, finished } = await tx(["outbox"], "readonly");
      const [rows] = await Promise.all([request(t.objectStore("outbox").index("owner").getAll(ownerId)), finished]);
      return (rows as OutboxOp[]).sort((a, b) => a.createdAt - b.createdAt);
    },
    async removeOp(ownerId, eventId, upToRev) {
      const { t, finished } = await tx(["outbox"], "readwrite");
      const store = t.objectStore("outbox");
      if (upToRev === undefined) store.delete([ownerId, eventId]);
      else {
        // Leitura e remoção na mesma transação: uma edição mais nova que a confirmada não é apagada.
        const read = store.get([ownerId, eventId]);
        read.onsuccess = () => { if (((read.result as OutboxOp | undefined)?.rev ?? Infinity) <= upToRev) store.delete([ownerId, eventId]); };
      }
      await finished;
    },
    async clearOwner(ownerId) {
      const { t, finished } = await tx(["events", "outbox", "meta"], "readwrite");
      t.objectStore("events").delete(ownerRange(ownerId));
      t.objectStore("outbox").delete(ownerRange(ownerId));
      t.objectStore("meta").delete(ownerRange(ownerId));
      await finished;
    },
  };
}

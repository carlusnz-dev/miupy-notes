import type { NoteOutput } from "./notes-api";
import type { Draft } from "./notes-autosave";
import type { Eol } from "./notes-markdown";

/**
 * Último snapshot completo de uma nota ainda não confirmada pelo servidor.
 * `revision` conta edições locais; `writeId` distingue escritas de filas diferentes.
 */
export type DraftRecord = {
  ownerId: string;
  noteId: string;
  draft: Draft;
  eol: Eol;
  /** Versão do servidor sobre a qual `draft` foi escrito, com o conteúdo daquela versão. */
  base: NoteOutput;
  revision: number;
  /** Identidade única desta escrita; ausente em registros legados. */
  writeId?: string;
  savedAt: number;
};

export type DraftVersion = Pick<DraftRecord, "revision" | "writeId">;

export const localDraftConflict = () => Object.assign(new Error("Outro editor alterou o rascunho local. Preserve seu texto antes de recarregar o aplicativo."), { code: "LOCAL_DRAFT_CONFLICT" });

/** undefined permite operações administrativas/legadas; null exige ausência de registro. */
export function matchesDraftVersion(stored: DraftRecord | undefined, expected: DraftVersion | null | undefined) {
  return expected === undefined || (expected === null ? !stored : !!stored && stored.revision === expected.revision && stored.writeId === expected.writeId);
}

/**
 * Armazenamento durável e assíncrono dos rascunhos, isolado por conta (`ownerId`). Não guarda tokens.
 * `put` só resolve depois de o dado estar gravado; rejeitar significa "não protegido".
 */
export interface DraftStore {
  put(record: DraftRecord, expected?: DraftVersion | null): Promise<void>;
  get(ownerId: string, noteId: string): Promise<DraftRecord | null>;
  listByOwner(ownerId: string): Promise<DraftRecord[]>;
  /** ACK compara `expected` e o limite de revisão atomicamente; sem condição é descarte explícito. */
  remove(ownerId: string, noteId: string, upToRevision?: number, expected?: DraftVersion | null): Promise<void>;
  clearOwner(ownerId: string): Promise<void>;
}

/** Cópia que não compartilha referências com o chamador (o IndexedDB também copia). */
const copy = <T,>(value: T): T => structuredClone(value);

/** Em memória: para testes e como porta de falhas injetáveis. Não é durável e nunca é usado como reserva silenciosa. */
export function createMemoryDraftStore(): DraftStore & { records: Map<string, DraftRecord> } {
  const records = new Map<string, DraftRecord>();
  const key = (ownerId: string, noteId: string) => `${ownerId}\u0000${noteId}`;
  return {
    records,
    async put(record, expected) {
      const k = key(record.ownerId, record.noteId);
      if (!matchesDraftVersion(records.get(k), expected)) throw localDraftConflict();
      records.set(k, copy(record));
    },
    async get(ownerId, noteId) {
      const found = records.get(key(ownerId, noteId));
      return found ? copy(found) : null;
    },
    async listByOwner(ownerId) { return [...records.values()].filter((record) => record.ownerId === ownerId).map(copy); },
    async remove(ownerId, noteId, upToRevision, expected) {
      const k = key(ownerId, noteId);
      const stored = records.get(k);
      if (!matchesDraftVersion(stored, expected)) throw localDraftConflict();
      if (stored && (upToRevision === undefined || stored.revision <= upToRevision)) records.delete(k);
    },
    async clearOwner(ownerId) {
      for (const [k, record] of records) if (record.ownerId === ownerId) records.delete(k);
    },
  };
}

/** Sem suporte a armazenamento durável: toda escrita falha, para a tela mostrar "sem proteção local". */
export function createUnavailableDraftStore(reason = "Armazenamento local indisponível."): DraftStore {
  const fail = () => Promise.reject(new Error(reason));
  return { put: fail, get: () => Promise.resolve(null), listByOwner: () => Promise.resolve([]), remove: fail, clearOwner: fail };
}

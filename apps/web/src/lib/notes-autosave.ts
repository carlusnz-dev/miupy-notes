import type { ApiError } from "./api-client";
import type { NoteOutput } from "./notes-api";
import { fromEditorText, toEditorText, type Eol } from "./notes-markdown";

// Limites iguais aos do contrato (apps/api/src/modules/notes/dto/input.ts).
export const MAX_TITLE = 200;
export const MAX_BODY = 100_000;
export const MAX_TAGS = 20;
export const MAX_TAG = 40;

/** `body` fica com \n no editor; o fim de linha original da nota volta na gravação (ver notes-markdown.ts). */
export type Draft = { title: string; body: string; tags: string[] };

export function toDraft(note: NoteOutput): Draft {
  return { title: note.title, body: toEditorText(note.body), tags: note.tags };
}

/** Só os campos alterados vão no PATCH; `null` quando não há o que salvar. */
export function changes(note: NoteOutput, draft: Draft, eol: Eol) {
  const title = draft.title.trim();
  const result: { title?: string; body?: string; tags?: string[] } = {};
  if (title !== note.title) result.title = title;
  if (draft.body !== toEditorText(note.body)) result.body = fromEditorText(draft.body, eol);
  if (draft.tags.join("\u0000") !== note.tags.join("\u0000")) result.tags = draft.tags;
  return Object.keys(result).length ? result : null;
}

export function validate(draft: Draft, eol: Eol, formatCount: (n: number) => string = String): string | null {
  const title = draft.title.trim();
  if (!title) return "Informe um título.";
  if (title.length > MAX_TITLE) return `O título passa de ${MAX_TITLE} caracteres.`;
  if (fromEditorText(draft.body, eol).length > MAX_BODY) return `O texto passa de ${formatCount(MAX_BODY)} caracteres.`;
  if (draft.tags.length > MAX_TAGS) return `Use no máximo ${MAX_TAGS} tags.`;
  if (draft.tags.some((tag) => tag.length > MAX_TAG)) return `Cada tag pode ter até ${MAX_TAG} caracteres.`;
  return null;
}

/** Uma fotografia do texto: o que seria gravado se a nota fosse salva agora. */
export type Snapshot = { draft: Draft; eol: Eol };

/** Estado de gravação de uma nota, como a tela o enxerga. Cada mudança cria um objeto novo. */
export type EntryView = {
  /** Última versão confirmada pelo servidor. */
  base: NoteOutput;
  /** Texto mais novo ainda não confirmado (mantido se a gravação falhar ou houver conflito). */
  pending: Snapshot | null;
  /** Texto do PATCH em andamento. */
  sending: Snapshot | null;
  /** 409: outra gravação ocorreu; nada é reenviado sozinho e o texto continua guardado. */
  blocked: boolean;
  error: ApiError | null;
};

export type SubmitResult =
  | { status: "unknown" }
  | { status: "invalid"; message: string }
  | { status: "blocked" }
  | { status: "clean" }
  | { status: "queued" };

type Entry = {
  base: NoteOutput;
  pending: Snapshot | null;
  sending: Snapshot | null;
  blocked: boolean;
  error: ApiError | null;
  /** Geração da sessão em que `pending` foi registrado; só texto da geração atual é enviado sozinho. */
  pendingGeneration: number;
  running: boolean;
  drain: Promise<void> | null;
  view: EntryView;
};

const sessionEnded = () => Object.assign(new Error("Sua sessão terminou. Entre de novo."), { code: "UNAUTHORIZED" }) as ApiError;

export type QueueDeps = {
  update: (id: string, input: { version: number; title?: string; body?: string; tags?: string[] }) => Promise<NoteOutput>;
  /** Cada versão confirmada, para o cache de consultas (mesmo que a tela já tenha mudado de nota). */
  onSaved?: (note: NoteOutput) => void;
  onError?: (error: ApiError, noteId: string) => void;
  formatCount?: (n: number) => string;
};

/**
 * Fila de gravação por nota, fora do React: sobrevive a trocar de nota e a desmontar a tela.
 *
 * - Uma gravação por vez em cada nota; notas diferentes não se bloqueiam.
 * - `pending` guarda sempre o texto mais novo. Terminado um PATCH, a nova `version` vira a base e o `pending`
 *   é enviado em seguida, mesmo que o usuário já esteja em outra nota (nada digitado durante um PATCH some).
 * - Falha ou 409 não descartam o texto: ele fica em memória (nunca em localStorage) até gravar, recarregar
 *   por escolha do usuário (`reset`) ou sair da conta (`clear`). `attach` o devolve ao reabrir a nota.
 * - O resultado de uma nota nunca é aplicado a outra: cada entrada tem os próprios ouvintes.
 * - Sessão: `clear` (sair da conta) e `endSession` (sessão expirada) avançam a geração. Resposta de PATCH iniciado
 *   antes disso é ignorada (não atualiza base nem cache) e a fila nunca envia, por conta própria, texto de uma
 *   geração anterior com o token da nova: só um novo `submit` do usuário o envia.
 */
export function createAutosaveQueue(deps: QueueDeps) {
  const entries = new Map<string, Entry>();
  let generation = 0;
  const listeners = new Map<string, Set<() => void>>();

  const notify = (id: string, entry: Entry) => {
    entry.view = { base: entry.base, pending: entry.pending, sending: entry.sending, blocked: entry.blocked, error: entry.error };
    listeners.get(id)?.forEach((listener) => listener());
  };

  function snapshotOf(entry: Entry, draft: Draft, eol: Eol, leaving: boolean): { snapshot: Snapshot; message: string | null } {
    // Saindo: um título em branco não impede guardar o resto (o título salvo é mantido).
    const candidate = leaving && !draft.title.trim() ? { ...draft, title: entry.base.title } : draft;
    return { snapshot: { draft: candidate, eol }, message: validate(candidate, eol, deps.formatCount) };
  }

  async function run(id: string, entry: Entry) {
    try {
      while (entry.pending && !entry.blocked && entry.pendingGeneration === generation) {
        const snapshot = entry.pending;
        const patch = changes(entry.base, snapshot.draft, snapshot.eol);
        if (!patch) {
          entry.pending = null;
          break;
        }
        const startedIn = generation;
        entry.sending = snapshot;
        entry.error = null;
        notify(id, entry);
        let saved: NoteOutput | null = null;
        let failure: ApiError | null = null;
        try {
          saved = await deps.update(id, { version: entry.base.version, ...patch });
        } catch (error) {
          failure = error as ApiError;
        }
        entry.sending = null;
        if (startedIn !== generation) {
          // A sessão mudou durante o PATCH: o resultado (sucesso ou erro) não é de quem está na tela agora.
          // O texto enviado fica guardado, e um texto mais novo da sessão atual (se houver) segue na volta.
          if (!entry.pending) { entry.pending = snapshot; entry.pendingGeneration = startedIn; }
          if (entry.pendingGeneration !== generation) entry.error = sessionEnded();
          notify(id, entry);
          continue;
        }
        if (failure) {
          if (failure.code === "CONFLICT") entry.blocked = true;
          else entry.error = failure;
          notify(id, entry);
          deps.onError?.(failure, id);
          return;
        }
        entry.base = saved!;
        // Se o usuário digitou durante o PATCH, `pending` já é outro objeto e segue para a próxima volta.
        if (entry.pending === snapshot) entry.pending = null;
        deps.onSaved?.(saved!);
        notify(id, entry);
      }
      notify(id, entry);
    } finally {
      entry.running = false;
    }
  }

  function kick(id: string, entry: Entry) {
    if (entry.running) return;
    entry.running = true;
    entry.drain = run(id, entry);
  }

  return {
    /**
     * Abre a nota. Se há texto não gravado desta nota (falha, conflito, PATCH em andamento), devolve-o em
     * `restored` com a versão base correspondente; caso contrário, a versão carregada (ou a salva mais nova).
     */
    attach(loaded: NoteOutput): { note: NoteOutput; restored: Snapshot | null } {
      const entry = entries.get(loaded.id);
      if (!entry) {
        const created: Entry = { base: loaded, pending: null, sending: null, blocked: false, error: null, pendingGeneration: generation, running: false, drain: null, view: undefined as unknown as EntryView };
        entries.set(loaded.id, created);
        notify(loaded.id, created);
        return { note: loaded, restored: null };
      }
      const unsent = entry.pending ?? entry.sending;
      if (unsent) return { note: entry.base, restored: unsent };
      if (loaded.version > entry.base.version) {
        entry.base = loaded;
        notify(loaded.id, entry);
      }
      return { note: entry.base, restored: null };
    },

    view(id: string): EntryView | undefined {
      return entries.get(id)?.view;
    },

    subscribe(id: string, listener: () => void): () => void {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set);
      set.add(listener);
      return () => { set.delete(listener); };
    },

    /** Registra o texto mais novo e, se nenhuma gravação desta nota está em andamento, começa a enviar. */
    submit(id: string, draft: Draft, eol: Eol, options: { leaving?: boolean } = {}): SubmitResult {
      const entry = entries.get(id);
      if (!entry) return { status: "unknown" };
      entry.pendingGeneration = generation;
      const { snapshot, message } = snapshotOf(entry, draft, eol, options.leaving === true);
      if (message) {
        // Ao sair não dá para mostrar o erro: o texto fica guardado para quando a nota for reaberta.
        if (options.leaving) {
          entry.pending = snapshot;
          notify(id, entry);
        }
        return { status: "invalid", message };
      }
      if (entry.blocked) {
        entry.pending = snapshot;
        notify(id, entry);
        return { status: "blocked" };
      }
      if (!entry.sending && !changes(entry.base, snapshot.draft, eol)) {
        if (entry.pending || entry.error) {
          entry.pending = null;
          entry.error = null;
          notify(id, entry);
        }
        return { status: "clean" };
      }
      entry.pending = snapshot;
      kick(id, entry);
      return { status: "queued" };
    },

    /** Espera a gravação em andamento; `true` quando não resta texto sem gravar nem erro/conflito. */
    async flush(id: string): Promise<boolean> {
      const entry = entries.get(id);
      if (!entry) return true;
      while (entry.running && entry.drain) await entry.drain;
      return !entry.pending && !entry.sending && !entry.blocked && !entry.error;
    },

    /** Escolha explícita do usuário (recarregar após conflito): descarta o texto guardado e adota `fresh`. */
    reset(fresh: NoteOutput) {
      const entry = entries.get(fresh.id);
      if (!entry) { this.attach(fresh); return; }
      entry.base = fresh;
      entry.pending = null;
      entry.blocked = false;
      entry.error = null;
      notify(fresh.id, entry);
    },

    /** A nota foi excluída: nada a gravar. */
    discard(id: string) {
      entries.delete(id);
    },

    hasUnsaved(): boolean {
      return [...entries.values()].some((entry) => entry.pending || entry.sending);
    },

    /** Sair da conta: nenhum texto de notas fica em memória e respostas em voo são ignoradas. */
    clear() {
      generation++;
      entries.clear();
    },

    /**
     * Sessão expirada (401): o texto não gravado continua recuperável, mas não é enviado até o usuário
     * entrar de novo e pedir (salvar ou editar); respostas de PATCH em voo são ignoradas.
     */
    endSession() {
      generation++;
      for (const [id, entry] of entries) {
        if (!entry.pending && !entry.sending) continue;
        entry.error = sessionEnded();
        notify(id, entry);
      }
    },
  };
}

export type AutosaveQueue = ReturnType<typeof createAutosaveQueue>;

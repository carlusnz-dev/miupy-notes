import type { ApiError } from "./api-client";
import type { NoteOutput } from "./notes-api";
import type { DraftStore } from "./notes-draft-store";
import { fromEditorText, toEditorText, type Eol } from "./notes-markdown";
import { backoffDelay, createScheduler, systemClock, type Clock, type SchedulerOptions } from "./notes-scheduler";

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


/** O servidor já tem este texto (título, corpo e tags), qualquer que seja a versão. */
export function sameContent(a: NoteOutput, b: NoteOutput) {
  return a.title === b.title && a.body === b.body && a.tags.join("\u0000") === b.tags.join("\u0000");
}

/** Uma fotografia do texto: o que seria gravado se a nota fosse salva agora. */
export type Snapshot = { draft: Draft; eol: Eol };

/**
 * Situação da nota para a tela:
 * - `synced`: o servidor confirmou o texto atual E o armazenamento local já foi atualizado/limpo.
 * - `protecting`: gravando o texto (ou a limpeza) no armazenamento local; ainda não é "protegido".
 * - `local`: texto novo gravado no armazenamento local (confirmado pela escrita), ainda não enviado.
 * - `local-failed`: a escrita/limpeza local falhou (`localIssue`); nada é enviado enquanto o texto não for gravado.
 * - `saving`: PATCH em andamento. `offline`: sem rede, nova tentativa agendada. `error`: falha do envio.
 * - `conflict`: outra gravação ocorreu; nada é reenviado sozinho. `paused`: sessão expirada (401).
 */
export type SyncStatus = "synced" | "protecting" | "local" | "local-failed" | "saving" | "offline" | "error" | "conflict" | "paused";

/** Estado de uma nota como a tela o enxerga. Cada mudança cria um objeto novo. */
export type EntryView = {
  /** Última versão confirmada pelo servidor. */
  base: NoteOutput;
  /** Texto mais novo ainda não confirmado pelo servidor. */
  snapshot: Snapshot | null;
  status: SyncStatus;
  /** `write`: o texto novo não foi gravado; `cleanup`: confirmado no servidor, mas o registro local não pôde ser atualizado. */
  localIssue: "write" | "cleanup" | null;
  /** Texto atual não pode ser enviado (validação); continua protegido localmente. */
  invalid: string | null;
  error: ApiError | null;
  /** Há retry automático agendado. */
  retrying: boolean;
};

export type EditResult =
  | { status: "unknown" }
  | { status: "invalid"; message: string }
  | { status: "blocked" }
  | { status: "clean" }
  | { status: "queued" };

type Halt = "edit" | "manual" | null;

type Entry = {
  id: string;
  base: NoteOutput;
  snapshot: Snapshot | null;
  /** Contador local de edições; identifica o texto que uma resposta confirma. */
  revision: number;
  /** Maior revisão cuja gravação local foi confirmada. */
  durable: number;
  /** Revisão cujo PATCH está em andamento. */
  inflight: number | null;
  /**
   * Revisão que o servidor já tem (ou igual à base). O `snapshot` é mantido até a limpeza do registro local
   * ser gravada: só então a nota passa a `synced`. Nova edição substitui a confirmação.
   */
  confirmed: number | null;
  blocked: boolean;
  /** Erro que não melhora sozinho: `edit` espera correção do texto; `manual` espera o usuário tentar de novo. */
  halt: Halt;
  error: ApiError | null;
  retrying: boolean;
  attempts: number;
  notBefore: number;
  /** Fim do período imposto por `Retry-After`: nem "voltou a conexão" nem "salvar" antecipam. */
  floorUntil: number;
  /** O resultado do último envio é desconhecido (timeout, 5xx, queda): reler o servidor antes de reenviar. */
  reconcile: boolean;
  invalid: string | null;
  storeFailed: boolean;
  storeAttempts: number;
  held: boolean;
  dead: boolean;
  writing: Promise<void> | null;
  writeDirty: boolean;
  view: EntryView;
};

const codeError = (code: string, message: string) => Object.assign(new Error(message), { code }) as ApiError;
const sessionEnded = () => codeError("UNAUTHORIZED", "Sua sessão terminou. Entre de novo.");
const localReadFailed = (cause: unknown) => Object.assign(codeError("LOCAL_READ_FAILED", "Não foi possível ler os rascunhos guardados neste computador."), { cause });

/** Leitura local falhou ao abrir a nota: a tela não pode editar (nem sobrescrever um rascunho possivelmente existente). */
export const isLocalReadFailure = (error: unknown) => (error as { code?: string } | null)?.code === "LOCAL_READ_FAILED";

type Failure = { kind: "unauthorized" | "conflict" | "temporary" | "invalid" | "other"; ambiguous: boolean; retryAfterMs: number };

/** Classifica o erro de um PATCH. `ambiguous`: o servidor pode ter aplicado a gravação antes de a resposta se perder. */
export function classifyFailure(error: ApiError & { retryAfterMs?: number }): Failure {
  const status = error.status;
  const retryAfterMs = error.retryAfterMs ?? 0;
  if (error.code === "UNAUTHORIZED" || status === 401) return { kind: "unauthorized", ambiguous: false, retryAfterMs };
  if (error.code === "CONFLICT" || status === 409) return { kind: "conflict", ambiguous: false, retryAfterMs };
  if (status === 429) return { kind: "temporary", ambiguous: false, retryAfterMs };
  if (error.code === "NETWORK_ERROR" || status === 408 || (status !== undefined && status >= 500)) return { kind: "temporary", ambiguous: true, retryAfterMs };
  if (status === 400 || status === 422 || error.code === "VALIDATION_ERROR") return { kind: "invalid", ambiguous: false, retryAfterMs };
  return { kind: "other", ambiguous: true, retryAfterMs };
}

export type QueueDeps = {
  update: (id: string, input: { version: number; title?: string; body?: string; tags?: string[] }) => Promise<NoteOutput>;
  /** Leitura do servidor, usada para reconciliar um envio de resultado desconhecido (nunca para sobrescrever texto local). */
  read: (id: string) => Promise<NoteOutput>;
  store: DraftStore;
  /** Cada versão confirmada, para o cache de consultas (mesmo que a tela já tenha mudado de nota). */
  onSaved?: (note: NoteOutput) => void;
  onError?: (error: ApiError, noteId: string) => void;
  formatCount?: (n: number) => string;
  clock?: Clock;
  random?: () => number;
  scheduler?: Omit<SchedulerOptions, "clock">;
};

export type CloseResult = { purged: boolean; error?: unknown };

/**
 * Fila de gravação das notas da conta ativa, fora do React: sobrevive a trocar de nota e a desmontar a tela.
 *
 * - `edit` registra cada alteração (mesmo inválida) em memória e, de forma coalescida, no `DraftStore`; só o
 *   scheduler decide quando há PATCH (pausa de digitação, teto de espera, um envio por vez no app e por nota).
 * - Nada é enviado antes de a gravação local da revisão ter sido confirmada: falha local impede o PATCH.
 * - A nota só vira `synced` depois de o servidor confirmar E o registro local ser removido/atualizado; falha
 *   dessa limpeza aparece como `local-failed` (`cleanup`) e é repetida, sem reenviar o PATCH.
 * - 409 não reenvia; 400/422 espera correção; 429/5xx/queda reagendam com backoff e, quando o resultado é
 *   ambíguo, releem o servidor antes de reenviar. `Retry-After` é um piso que nem "online" nem "salvar" reduzem.
 * - Sessão: toda operação assíncrona confere a geração (`session`) e a existência da entrada ao voltar; resultado
 *   de sessão anterior é ignorado. Leitura local com erro não é engolida: `attach` rejeita (`LOCAL_READ_FAILED`).
 */
export function createAutosaveQueue(deps: QueueDeps) {
  const clock = deps.clock ?? systemClock;
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  let owner: string | null = null;
  let session = 0;
  let paused = false;
  let ready: Promise<void> = Promise.resolve();
  let restoreError: unknown = null;
  /** Limpezas locais que falharam (logout/exclusão); repetidas na próxima abertura de sessão, antes de restaurar. */
  const pendingPurge = new Set<string>();
  const pendingDiscard = new Map<string, string>();

  const scheduler = createScheduler((id) => run(id), { ...deps.scheduler, clock });

  /** Texto ainda não confirmado pelo servidor. */
  const live = (e: Entry): Snapshot | null => (e.snapshot && e.confirmed !== e.revision ? e.snapshot : null);
  const cleaning = (e: Entry) => e.snapshot !== null && e.confirmed === e.revision;

  const statusOf = (e: Entry): SyncStatus => {
    if (e.inflight !== null) return "saving";
    const text = live(e);
    if ((text || cleaning(e)) && e.storeFailed) return "local-failed";
    if (text && e.durable !== e.revision) return "protecting";
    if (cleaning(e)) return "protecting";
    if (e.blocked) return "conflict";
    if (paused && text) return "paused";
    if (e.halt) return "error";
    if (e.error) return e.error.code === "NETWORK_ERROR" ? "offline" : "error";
    return text ? "local" : "synced";
  };

  function notify(e: Entry) {
    const text = live(e);
    e.view = {
      base: e.base, snapshot: text, status: statusOf(e),
      localIssue: e.storeFailed ? (cleaning(e) ? "cleanup" : "write") : null,
      invalid: e.invalid, error: paused && text && !e.error ? sessionEnded() : e.error, retrying: e.retrying,
    };
    listeners.get(e.id)?.forEach((listener) => listener());
  }

  function newEntry(base: NoteOutput, over: Partial<Entry> = {}): Entry {
    const e: Entry = {
      id: base.id, base, snapshot: null, revision: 0, durable: 0, inflight: null, confirmed: null,
      blocked: false, halt: null, error: null, retrying: false, attempts: 0, notBefore: 0, floorUntil: 0, reconcile: false,
      invalid: null, storeFailed: false, storeAttempts: 0, held: false, dead: false, writing: null, writeDirty: false,
      view: undefined as unknown as EntryView, ...over,
    };
    entries.set(e.id, e);
    notify(e);
    return e;
  }

  // ---- armazenamento local -------------------------------------------------------------------------------

  /**
   * Leva o armazenamento ao estado atual da nota, no máximo uma escrita por vez (edições durante a escrita viram
   * uma só nova). Texto não confirmado → `put`; confirmado/limpo → `remove` das revisões ≤ à atual (nunca uma mais nova).
   * Só após o `put` confirmar a revisão vira `durable`; só após o `remove` confirmar o texto confirmado sai da memória.
   */
  function persist(e: Entry) {
    e.writeDirty = true;
    if (e.writing) return;
    const ownerId = owner;
    if (!ownerId) return;
    e.writing = (async () => {
      while (e.writeDirty && !e.dead && owner === ownerId) {
        e.writeDirty = false;
        const { snapshot, revision, base } = e;
        const clearing = !snapshot || e.confirmed === revision;
        try {
          if (clearing) {
            await deps.store.remove(ownerId, e.id, revision);
            if (e.revision === revision && e.confirmed === revision) { e.snapshot = null; e.confirmed = null; e.invalid = null; }
          } else {
            await deps.store.put({ ownerId, noteId: e.id, draft: snapshot.draft, eol: snapshot.eol, base, revision, savedAt: clock.now() });
            e.durable = Math.max(e.durable, revision);
          }
          if (e.revision === revision || !clearing) { e.storeFailed = false; e.storeAttempts = 0; }
        } catch {
          // Sem gravação confirmada o texto NÃO é anunciado como protegido, e nada depende dele.
          if (e.snapshot && !e.dead) { e.storeFailed = true; retryStore(e); }
        }
        if (!e.dead) notify(e);
      }
      e.writing = null;
      if (!e.dead) notify(e); // quem espera a escrita terminar (flush) só a vê concluída agora
    })();
  }

  async function settleWrites(e: Entry) {
    while (e.writing) await e.writing;
  }

  function retryStore(e: Entry) {
    e.storeAttempts++;
    scheduler.at(e.id, backoffDelay(e.storeAttempts, 0, { random: deps.random }));
  }

  // ---- decisões sobre o estado do servidor ---------------------------------------------------------------

  /** Compara o servidor com a base do rascunho. Devolve `false` quando não há versão mais nova (nada mudou). */
  function applyServer(e: Entry, server: NoteOutput): boolean {
    if (!live(e) || server.version <= e.base.version) return false;
    const text = live(e)!;
    if (!changes(server, text.draft, text.eol)) {
      // O servidor já tem exatamente este texto (envio anterior chegou a ser aplicado).
      e.base = server;
      e.confirmed = e.revision;
      resetFailure(e);
      persist(e);
      deps.onSaved?.(server);
    } else if (sameContent(server, e.base)) {
      // Mudou só metadado (pasta etc.): o texto do rascunho continua válido sobre a versão nova.
      e.base = server;
      e.reconcile = false;
      persist(e);
    } else {
      e.blocked = true;
      scheduler.cancel(e.id);
    }
    notify(e);
    return true;
  }

  function resetFailure(e: Entry) {
    e.halt = null;
    e.error = null;
    e.retrying = false;
    e.attempts = 0;
    e.notBefore = 0;
    e.floorUntil = 0;
    e.reconcile = false;
  }

  function fail(e: Entry, error: ApiError) {
    const failure = classifyFailure(error);
    e.error = error;
    if (failure.kind === "unauthorized") {
      suspend();
      deps.onError?.(error, e.id);
      return;
    }
    if (failure.kind === "conflict") {
      e.blocked = true;
      e.error = null;
    } else if (failure.kind === "temporary") {
      e.attempts++;
      e.reconcile = failure.ambiguous;
      const delay = backoffDelay(e.attempts, failure.retryAfterMs, { random: deps.random });
      e.notBefore = clock.now() + delay;
      if (failure.retryAfterMs > 0) e.floorUntil = clock.now() + Math.min(failure.retryAfterMs, MAX_RETRY_AFTER_MS);
      e.retrying = true;
      scheduler.at(e.id, delay);
    } else {
      e.halt = failure.kind === "invalid" ? "edit" : "manual";
      e.reconcile = failure.ambiguous;
    }
    notify(e);
    deps.onError?.(error, e.id);
  }

  // ---- envio ---------------------------------------------------------------------------------------------

  async function run(id: string) {
    const e = entries.get(id);
    if (!e || e.dead || paused || e.held || e.inflight !== null) return;
    const token = session;
    const alive = () => !e.dead && token === session && entries.get(id) === e;

    // 1. O estado local vem primeiro: sem gravação confirmada do texto atual (ou da limpeza) nada é enviado.
    if (e.snapshot && (cleaning(e) || e.durable !== e.revision)) {
      persist(e);
      await settleWrites(e);
      if (!alive()) return;
      if (e.storeFailed) { notify(e); return; }
      if (e.durable !== e.revision && live(e)) return; // houve edição durante a escrita; o scheduler volta aqui
    }
    const snapshot = live(e);
    if (!snapshot || e.blocked || e.halt) return;

    const revision = e.revision;
    e.invalid = validate(snapshot.draft, snapshot.eol, deps.formatCount);
    if (e.invalid) { notify(e); return; }
    if (!changes(e.base, snapshot.draft, snapshot.eol)) { clean(e); return; }
    // Retry local pode rodar antes do cooldown; somente leitura/PATCH precisam aguardar o piso remoto.
    const wait = e.floorUntil - clock.now();
    if (wait > 0) {
      e.notBefore = e.floorUntil;
      e.retrying = true;
      scheduler.at(id, wait);
      notify(e);
      return;
    }
    e.inflight = revision;
    e.retrying = false;
    notify(e);
    try {
      if (e.reconcile) {
        const server = await deps.read(id);
        if (!alive()) return;
        applyServer(e, server);
        e.reconcile = false;
        if (!live(e) || e.blocked) return;
      }
      const patch = changes(e.base, snapshot.draft, snapshot.eol);
      if (!patch) { clean(e); return; }
      const saved = await deps.update(id, { version: e.base.version, ...patch });
      if (!alive()) return;
      if (saved.version > e.base.version) e.base = saved;
      resetFailure(e);
      // Confirmado no servidor: o registro local só é limpo (e a nota só fica `synced`) depois do `remove` gravado.
      if (e.revision === revision) { e.confirmed = revision; e.invalid = null; }
      persist(e);
      deps.onSaved?.(saved);
    } catch (error) {
      if (alive()) fail(e, error as ApiError);
    } finally {
      if (alive()) { e.inflight = null; notify(e); }
    }
  }

  /** O texto igual ao da base não gera chamada: só limpa o registro local (e só então fica `synced`). */
  function clean(e: Entry) {
    e.confirmed = e.revision;
    e.invalid = null;
    resetFailure(e);
    scheduler.cancel(e.id);
    persist(e);
    notify(e);
  }

  /** Sessão expirada: guarda tudo, cancela o que estava em voo (resultado desconhecido) e para de enviar. */
  function suspend() {
    session++;
    paused = true;
    scheduler.pause();
    for (const e of entries.values()) {
      if (e.inflight !== null) e.reconcile = true;
      e.inflight = null;
      e.retrying = false;
      notify(e);
    }
  }

  function drop(e: Entry) {
    e.dead = true;
    scheduler.cancel(e.id);
  }

  function needsWork(e: Entry) {
    return live(e) !== null || cleaning(e);
  }

  function isIdle(e: Entry) {
    if (e.inflight !== null || e.writing) return false;
    return !needsWork(e) || e.blocked || !!e.halt || !!e.invalid || paused || e.retrying || e.held || e.storeFailed;
  }

  function waitFor(e: Entry, done: () => boolean) {
    return new Promise<void>((resolve) => {
      const set = listeners.get(e.id) ?? new Set();
      listeners.set(e.id, set);
      const check = () => { if (done() || e.dead) { set.delete(check); resolve(); } };
      set.add(check);
      check();
    });
  }

  async function runCleanups(): Promise<void> {
    for (const ownerId of [...pendingPurge]) {
      try { await deps.store.clearOwner(ownerId); pendingPurge.delete(ownerId); } catch { /* continua pendente; bloqueia a restauração desta conta */ }
    }
    for (const [key, ownerId] of [...pendingDiscard]) {
      try { await deps.store.remove(ownerId, key.slice(ownerId.length + 1)); pendingDiscard.delete(key); } catch { /* idem */ }
    }
  }

  async function loadRecords(ownerId: string, token: number) {
    let records: Awaited<ReturnType<DraftStore["listByOwner"]>>;
    try { records = await deps.store.listByOwner(ownerId); } catch (error) {
      if (token === session) restoreError = error;
      return;
    }
    if (token !== session) return;
    restoreError = null;
    for (const record of records) {
      if (entries.has(record.noteId)) continue;
      newEntry(record.base, { snapshot: { draft: record.draft, eol: record.eol }, revision: record.revision, durable: record.revision, reconcile: true });
    }
  }

  function startAll() {
    scheduler.resume();
    for (const e of entries.values()) {
      if (live(e) && !e.blocked && !e.halt) scheduler.edit(e.id);
      else if (cleaning(e)) scheduler.at(e.id, 0);
      notify(e);
    }
  }

  return {
    /** Começa a sessão de uma conta: restaura os rascunhos dela do armazenamento local e retoma os envios. */
    openSession(ownerId: string): Promise<void> {
      const token = ++session;
      if (ownerId !== owner) {
        for (const e of entries.values()) drop(e);
        entries.clear();
        scheduler.clear();
        owner = ownerId;
      }
      const wasPaused = paused;
      paused = false;
      restoreError = null;
      ready = (async () => {
        await runCleanups();
        if (token !== session) return;
        if (pendingPurge.has(ownerId)) { restoreError = new Error("A limpeza anterior dos rascunhos desta conta falhou."); return; }
        await loadRecords(ownerId, token);
        if (token !== session) return;
        if (wasPaused) for (const e of entries.values()) { e.error = null; e.reconcile ||= live(e) !== null; }
        startAll();
      })();
      return ready;
    },

    /** Sessão expirada (401): rascunhos ficam; nada é enviado até `openSession` da mesma conta. */
    suspend,

    /** Erro da última leitura geral dos rascunhos locais (`null` se ok). A tela da nota usa `attach`, que rejeita. */
    restoreError: () => restoreError,

    /** Tenta de novo a leitura dos rascunhos da conta (decisão explícita do usuário após `LOCAL_READ_FAILED`). */
    async retryRestore(): Promise<void> {
      const token = session;
      if (!owner) return;
      await runCleanups();
      if (token !== session) return;
      if (pendingPurge.has(owner)) { restoreError = new Error("A limpeza anterior dos rascunhos desta conta falhou."); return; }
      await loadRecords(owner, token);
      if (token === session) startAll();
    },

    /**
     * Sair da conta. `purge`: apaga também os rascunhos locais dela (a confirmação com o usuário é de quem chama).
     * Se a limpeza falhar, `purged` é `false` e a conta fica marcada: a limpeza é repetida antes de qualquer
     * restauração futura, e nada dela é exibido a outra conta (o armazenamento é isolado por dono).
     */
    async closeSession(options: { purge: boolean }): Promise<CloseResult> {
      const ownerId = owner;
      session++;
      paused = false;
      owner = null;
      restoreError = null;
      const all = [...entries.values()];
      for (const e of all) drop(e);
      entries.clear();
      scheduler.clear();
      if (!options.purge || !ownerId) return { purged: true };
      pendingPurge.add(ownerId);
      await Promise.all(all.map(settleWrites));
      try {
        await deps.store.clearOwner(ownerId);
        pendingPurge.delete(ownerId);
        return { purged: true };
      } catch (error) {
        return { purged: false, error };
      }
    },

    /**
     * Abre a nota. Texto não gravado desta nota (da memória ou do armazenamento local) volta em `restored`,
     * com a versão base correspondente; caso contrário, vale a versão carregada (ou a confirmada mais nova).
     * Rejeita com `LOCAL_READ_FAILED` se o rascunho local não pôde ser lido (a menos que `ignoreLocal`, decisão
     * explícita do usuário de abrir sem ele), e com `UNAUTHORIZED` se a sessão mudou durante a operação.
     */
    async attach(loaded: NoteOutput, options: { ignoreLocal?: boolean } = {}): Promise<{ note: NoteOutput; restored: Snapshot | null }> {
      const token = session;
      await ready;
      if (token !== session) throw sessionEnded();
      const ownerId = owner;
      if (!ownerId || pendingPurge.has(ownerId)) throw ownerId ? localReadFailed(restoreError) : sessionEnded();
      const stale = () => token !== session || owner !== ownerId;
      let e = entries.get(loaded.id);
      if (!e) {
        let record = null;
        try { record = await deps.store.get(ownerId, loaded.id); } catch (error) {
          if (stale()) throw sessionEnded();
          if (!options.ignoreLocal) throw localReadFailed(error);
        }
        if (stale()) throw sessionEnded();
        e = entries.get(loaded.id);
        if (!e) {
          e = record
            ? newEntry(record.base, { snapshot: { draft: record.draft, eol: record.eol }, revision: record.revision, durable: record.revision, reconcile: true })
            : newEntry(loaded);
          if (record && !applyServer(e, loaded) && !e.blocked) scheduler.edit(e.id);
        }
      } else if (live(e) && e.reconcile) {
        applyServer(e, loaded);
      }
      if (!live(e) && !cleaning(e) && loaded.version > e.base.version) { e.base = loaded; notify(e); }
      return { note: e.base, restored: live(e) };
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

    /** Registra o texto mais novo (cada alteração, inclusive inválida) e deixa ao scheduler o momento do envio. */
    edit(id: string, draft: Draft, eol: Eol): EditResult {
      const e = entries.get(id);
      if (!e || e.dead) return { status: "unknown" };
      e.revision++;
      e.snapshot = { draft, eol };
      e.confirmed = null;
      e.invalid = validate(draft, eol, deps.formatCount);
      if (e.halt === "edit") { e.halt = null; e.error = null; }
      // Texto igual ao da base: nada a enviar; o registro local é limpo (só então `synced`).
      if (!e.invalid && !e.blocked && e.inflight === null && !changes(e.base, draft, eol)) { clean(e); return { status: "clean" }; }
      persist(e);
      if (e.blocked) { notify(e); return { status: "blocked" }; }
      // Mesmo inválido passa pelo scheduler: se a gravação local falhar, o retry nasce dali.
      if (!e.held && !e.halt) scheduler.edit(id, e.notBefore);
      notify(e);
      return e.invalid ? { status: "invalid", message: e.invalid } : { status: "queued" };
    },

    /** "Salvar agora": envia assim que o scheduler permitir e espera terminar. `true` se ficou sincronizada. */
    async flush(id: string): Promise<boolean> {
      const e = entries.get(id);
      if (!e) return true;
      if (e.halt === "manual") { e.halt = null; e.error = null; notify(e); }
      if (needsWork(e) && !e.blocked && !e.halt && !e.held && !paused) {
        // `Retry-After` continua valendo: salvar à mão não fura o limite imposto pelo servidor.
        const wait = Math.max(0, e.floorUntil - clock.now());
        e.notBefore = wait > 0 ? e.floorUntil : 0;
        e.retrying = wait > 0;
        scheduler.at(id, wait);
      }
      await waitFor(e, () => isIdle(e));
      return !e.dead && statusOf(e) === "synced";
    },

    /** Espera a escrita local; `true` se o texto atual está gravado (ou não há o que gravar). */
    async protect(id: string): Promise<boolean> {
      const e = entries.get(id);
      if (!e) return true;
      await settleWrites(e);
      if (e.storeFailed) return false;
      return !live(e) || e.durable === e.revision;
    },

    /**
     * Escolha explícita do usuário (recarregar após conflito): descarta o texto guardado e adota `fresh`.
     * `false` se o registro local não pôde ser removido (o estado fica `local-failed`; o texto antigo pode voltar no reload).
     */
    async reset(fresh: NoteOutput): Promise<boolean> {
      const e = entries.get(fresh.id);
      if (!e) return true;
      e.base = fresh;
      e.revision++;
      e.snapshot ??= { draft: toDraft(fresh), eol: "\n" };
      e.confirmed = e.revision;
      e.blocked = false;
      e.invalid = null;
      resetFailure(e);
      scheduler.cancel(e.id);
      persist(e);
      notify(e);
      await settleWrites(e);
      return !e.storeFailed;
    },

    /** Exclusão em andamento: para de enviar esta nota e espera o PATCH em voo terminar. */
    async hold(id: string) {
      const e = entries.get(id);
      if (!e) return;
      e.held = true;
      scheduler.cancel(id);
      await waitFor(e, () => e.inflight === null);
    },

    /** A exclusão falhou: a nota volta a ser enviada. */
    release(id: string) {
      const e = entries.get(id);
      if (!e) return;
      e.held = false;
      if (live(e) && !e.blocked && !e.halt) scheduler.edit(id, e.notBefore);
      notify(e);
    },

    /**
     * A nota foi excluída: nada a gravar, e respostas tardias não a recriam. `false` se o registro local não
     * pôde ser removido (repetido na próxima sessão; nunca reenviado, pois a entrada some).
     */
    async discard(id: string): Promise<boolean> {
      const e = entries.get(id);
      const ownerId = owner;
      if (!e) return true;
      drop(e);
      entries.delete(id);
      await settleWrites(e);
      if (!ownerId) return true;
      try { await deps.store.remove(ownerId, id); return true; } catch {
        pendingDiscard.set(`${ownerId}\u0000${id}`, ownerId);
        return false;
      }
    },

    /** Voltou a conexão: tira a espera do backoff das notas com falha temporária, menos o piso de `Retry-After`. */
    retryNow() {
      for (const e of entries.values()) {
        if (!e.retrying || paused) continue;
        const wait = Math.max(0, e.floorUntil - clock.now());
        e.notBefore = wait > 0 ? e.floorUntil : 0;
        scheduler.at(e.id, wait);
      }
    },

    /** Texto que nem o disco nem o servidor confirmaram: fechar a janela o perderia. */
    hasUnprotected(): boolean {
      return [...entries.values()].some((e) => (live(e) !== null && e.durable !== e.revision) || (needsWork(e) && e.storeFailed));
    },

    /** Quantas notas da conta têm texto ainda não confirmado pelo servidor. */
    unsyncedCount(): number {
      return [...entries.values()].filter((e) => live(e) !== null).length;
    },

    ready: () => ready,
    ownerId: () => owner,
    isPaused: () => paused,
  };
}

/** Teto de sanidade para `Retry-After` (um servidor não prende o app por mais de um dia). */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export type AutosaveQueue = ReturnType<typeof createAutosaveQueue>;

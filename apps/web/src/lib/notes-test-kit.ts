import { createAutosaveQueue, type QueueDeps } from "./notes-autosave";
import { createMemoryDraftStore, type DraftStore } from "./notes-draft-store";
import type { NoteOutput } from "./notes-api";
import type { Clock } from "./notes-scheduler";

// Apoio aos testes da fila: relógio, armazenamento e servidor falsos. Não é carregado pelo app.

export const created = "2026-10-20T12:00:00.000Z";
export const note = (id: string, over: Partial<NoteOutput> = {}): NoteOutput => ({ id, title: `Nota ${id}`, body: "", tags: [], folderId: null, createdAt: created, updatedAt: created, version: 1, ...over });
export const text = (title: string, body = "", tags: string[] = []) => ({ title, body, tags });

/** O ApiError real exige import.meta.env (Vite); o contrato usado pela fila é só `code`/`status`. */
export const apiError = (code: string, status?: number, retryAfterMs?: number) => Object.assign(new Error(code), { code, status, retryAfterMs });

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function fakeClock(): Clock & { advance(ms: number): Promise<void> } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(handle) { timers.delete(handle as number); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
      await settle();
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Behavior = (input: { version: number; title?: string; body?: string; tags?: string[] }, id: string) => Promise<NoteOutput>;

/** Servidor falso com versões por nota. `script` enfileira comportamentos para as próximas chamadas de PATCH. */
export function harness(options: { store?: DraftStore; deps?: Partial<QueueDeps> } = {}) {
  const clock = fakeClock();
  const memory = createMemoryDraftStore();
  const store = options.store ?? memory;
  const server = new Map<string, NoteOutput>([["a", note("a")], ["b", note("b")], ["c", note("c")]]);
  const calls: Array<{ id: string; at: number; version: number; body?: string; title?: string }> = [];
  const reads: string[] = [];
  const saved: string[] = [];
  const script: Behavior[] = [];
  let running = 0;
  let maxRunning = 0;

  const apply = (id: string, input: Parameters<Behavior>[0]) => {
    const current = server.get(id)!;
    if (current.version !== input.version) throw apiError("CONFLICT", 409);
    const { version: _version, ...fields } = input;
    const next = { ...current, ...fields, version: current.version + 1 } as NoteOutput;
    server.set(id, next);
    return next;
  };

  const deps: QueueDeps = {
    update: async (id, input) => {
      calls.push({ id, at: clock.now(), version: input.version, body: input.body, title: input.title });
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        const behavior = script.shift();
        return behavior ? await behavior(input, id) : apply(id, input);
      } finally { running--; }
    },
    read: async (id) => { reads.push(id); return server.get(id)!; },
    store,
    onSaved: (n) => saved.push(`${n.id}v${n.version}`),
    clock,
    random: () => 1,
    ...options.deps,
  };
  const queue = createAutosaveQueue(deps);
  return {
    queue, clock, store, memory, server, calls, reads, saved, script, apply,
    get maxRunning() { return maxRunning; },
    /** Abre a sessão da conta e a nota, como o editor faz. */
    async open(id = "a", owner = "u1") {
      await queue.openSession(owner);
      return queue.attach(server.get(id)!);
    },
  };
}

/** Relógio injetável: os testes avançam o tempo sem esperar. */
export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SchedulerOptions = {
  clock?: Clock;
  /** Pausa na digitação antes de enviar uma chave. */
  debounceMs?: number;
  /** Teto desde a primeira edição não enviada: digitação contínua não fica só local para sempre. */
  maxWaitMs?: number;
  /** Execuções simultâneas no app inteiro. */
  maxConcurrent?: number;
};

export const DEFAULT_DEBOUNCE_MS = 1800;
export const DEFAULT_MAX_WAIT_MS = 20_000;

type Slot = { dueAt: number; firstEditAt: number | null; notBefore: number };

/**
 * Agenda execuções por chave (uma nota), fora do React.
 *
 * - `edit` coalesce: uma chave tem um único horário (`dueAt`), empurrado a cada edição até o teto `maxWaitMs`.
 * - Uma chave nunca roda duas vezes ao mesmo tempo; no máximo `maxConcurrent` rodam no total.
 * - Entre as chaves vencidas, vai primeiro a de `dueAt` mais antigo: quem edita sem parar não adia as outras
 *   além do próprio teto.
 * - `notBefore` (backoff) vale também para novas edições: elas não encurtam uma espera de retry.
 */
export function createScheduler(run: (key: string) => Promise<void>, options: SchedulerOptions = {}) {
  const clock = options.clock ?? systemClock;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const maxConcurrent = options.maxConcurrent ?? 1;
  const slots = new Map<string, Slot>();
  const running = new Set<string>();
  let timer: unknown = null;
  let paused = false;

  function pump() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    if (paused) return;
    const now = clock.now();
    while (running.size < maxConcurrent) {
      let next: [string, Slot] | null = null;
      for (const entry of slots) {
        const [key, slot] = entry;
        if (running.has(key) || Math.max(slot.dueAt, slot.notBefore) > now) continue;
        if (!next || slot.dueAt < next[1].dueAt) next = entry;
      }
      if (!next) break;
      const key = next[0];
      slots.delete(key);
      running.add(key);
      // `run` não deve lançar; se lançar, a chave não fica presa.
      void run(key).catch(() => undefined).finally(() => { running.delete(key); pump(); });
    }
    // Com todas as vagas ocupadas, quem termina chama `pump` de novo: um timer agora só giraria à toa.
    if (running.size >= maxConcurrent) return;
    let wake = Infinity;
    for (const [key, slot] of slots) {
      if (!running.has(key)) wake = Math.min(wake, Math.max(slot.dueAt, slot.notBefore));
    }
    if (wake !== Infinity) timer = clock.setTimeout(() => { timer = null; pump(); }, Math.max(0, wake - now));
  }

  function slotFor(key: string): Slot {
    let slot = slots.get(key);
    if (!slot) { slot = { dueAt: 0, firstEditAt: null, notBefore: 0 }; slots.set(key, slot); }
    return slot;
  }

  return {
    /** Nova edição da chave: reinicia a pausa de digitação, respeitando o teto e um backoff em curso. */
    edit(key: string, notBefore = 0) {
      const now = clock.now();
      const slot = slotFor(key);
      slot.firstEditAt ??= now;
      slot.notBefore = Math.max(slot.notBefore, notBefore);
      slot.dueAt = Math.min(now + debounceMs, slot.firstEditAt + maxWaitMs);
      pump();
    },
    /** Executa a chave após `delayMs` (retry, ou 0 para "agora"); `delayMs` > 0 vira também o `notBefore`. */
    at(key: string, delayMs: number) {
      const now = clock.now();
      const slot = slotFor(key);
      slot.dueAt = now + delayMs;
      slot.notBefore = delayMs > 0 ? now + delayMs : 0;
      pump();
    },
    cancel(key: string) {
      slots.delete(key);
      pump();
    },
    pause() { paused = true; pump(); },
    resume() { paused = false; pump(); },
    /** Cancela tudo (troca de conta, saída). Execuções em andamento terminam sozinhas. */
    clear() {
      slots.clear();
      pump();
    },
    isScheduled: (key: string) => slots.has(key),
    isRunning: (key: string) => running.has(key),
    get runningCount() { return running.size; },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;

export type BackoffOptions = { baseMs?: number; capMs?: number; random?: () => number };

/** Espera antes da tentativa `attempt` (1, 2, …): exponencial com teto e jitter; `Retry-After` do servidor é um piso (sem o teto do backoff). */
export function backoffDelay(attempt: number, retryAfterMs = 0, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 2000;
  const cap = options.capMs ?? 5 * 60_000;
  const random = options.random ?? Math.random;
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jittered = exponential * (0.5 + random() * 0.5);
  // O teto vale só para o backoff próprio: o que o servidor pediu (`Retry-After`) é piso, mesmo acima dele.
  return Math.round(Math.max(jittered, retryAfterMs));
}

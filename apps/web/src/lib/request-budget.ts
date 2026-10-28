/** Orçamento único para todas as áreas, incluindo tentativas de leitura e escritas. */
export function createRequestBudget(now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  let next = 0;
  let cooldown = 0;
  let tail = Promise.resolve();
  return {
    defer(ms: number) { cooldown = Math.max(cooldown, now() + ms); },
    acquire(signal?: { aborted: boolean }) {
      const slot = tail.then(async () => {
        while (true) {
          if (signal?.aborted) throw new DOMException("Requisição cancelada.", "AbortError");
          const wait = Math.max(next, cooldown) - now();
          if (wait <= 0) break;
          await sleep(Math.min(wait, 100));
        }
        // 4/s, com margem para variação do transporte e janelas móveis de 1 s.
        next = now() + 300;
      });
      tail = slot.catch(() => undefined);
      return slot;
    },
  };
}
export const requestBudget = createRequestBudget();

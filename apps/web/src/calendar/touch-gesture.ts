/** Tempo parado até o toque num bloco entrar no modo mover, e tolerância de movimento nesse intervalo. */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP_PX = 8;

export type TouchPhase = "pending" | "armed" | "scroll";

/**
 * Fase de um toque num bloco: antes do limiar de tempo, mexer além da tolerância é um gesto de rolagem (o toque é
 * abandonado e a grade rola); parado, ele segue pendente. Depois do limiar o bloco está em modo mover e todo movimento arrasta.
 */
export function touchPhase(elapsedMs: number, distancePx: number): TouchPhase {
  if (elapsedMs >= LONG_PRESS_MS) return "armed";
  return distancePx > LONG_PRESS_SLOP_PX ? "scroll" : "pending";
}

/** Minuto (desde 00:00) que deve ficar no topo da grade ao abrir: a hora atual se hoje está visível, senão perto do primeiro evento (ou das 7h). */
export function initialScrollMin(firstEventMin: number | null, nowMin: number | null): number {
  if (nowMin !== null) return Math.max(0, nowMin - 60);
  return Math.max(0, Math.min(firstEventMin ?? 7 * 60, 7 * 60) - 30);
}

/** `scrollLeft` que centraliza `target` no contêiner de rolagem horizontal, sem passar das pontas. */
export function centeredScrollLeft(container: { left: number; width: number; scrollLeft: number; scrollWidth: number }, target: { left: number; width: number }): number {
  const centered = container.scrollLeft + (target.left - container.left) - (container.width - target.width) / 2;
  return Math.max(0, Math.min(container.scrollWidth - container.width, Math.round(centered)));
}

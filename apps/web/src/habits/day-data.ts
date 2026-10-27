import type { Occurrence } from "../lib/habits-api";

/** Ocorrências lidas para um dia: só valem para o dia da chave com que foram carregadas. */
export type DayData = { day: string; items: Occurrence[] };
export type DayView = { items: Occurrence[]; actionable: boolean };

/**
 * O que a tela pode mostrar para o dia visível. Dados de outro dia nunca aparecem sob o cabeçalho atual, e uma leitura
 * que falhou deixa a lista (mesmo a do mesmo dia) só para consulta.
 */
export function dayView(data: DayData | null, day: string, readFailed: boolean): DayView | null {
  return data?.day === day ? { items: data.items, actionable: !readFailed } : null;
}

/** Pedido de PUT para alternar a ocorrência, ou `null` se ela não pertence ao dia visível ou a lista não aceita ações. */
export function toggleRequest(view: DayView | null, day: string, item: Occurrence) {
  if (!view?.actionable || item.date !== day || !view.items.includes(item)) return null;
  return { habitId: item.habitId, date: item.date, status: item.status === "completed" ? "pending" as const : "completed" as const };
}

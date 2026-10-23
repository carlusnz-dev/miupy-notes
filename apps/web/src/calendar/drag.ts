import { addDays, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import type { DisplayStatus } from "./outbox";
import { browserZone, wallTimeToInstantStrict } from "./time";

/** Passo de encaixe e duração mínima do bloco, em minutos. */
export const SNAP_MIN = 15;
export const DAY_MIN = 1440;

export type Span = { startMin: number; endMin: number };

export const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;

/** Move o bloco por `delta` minutos mantendo a duração; o início encaixa em 15 min e o bloco não sai do dia. */
export function moveSpan(span: Span, deltaMin: number): Span {
  const duration = span.endMin - span.startMin;
  const startMin = Math.min(DAY_MIN - duration, Math.max(0, snap(span.startMin + deltaMin)));
  return { startMin, endMin: startMin + duration };
}

/** Arrasta a borda inferior: o fim encaixa em 15 min, no mínimo 15 min depois do início e até a meia-noite. */
export function resizeSpan(span: Span, deltaMin: number): Span {
  return { startMin: span.startMin, endMin: Math.min(DAY_MIN, Math.max(span.startMin + SNAP_MIN, snap(span.endMin + deltaMin))) };
}

/** Instante ISO de "dia + minutos desde 00:00" no relógio do navegador (o da grade); `null` se o horário não existe (salto do horário de verão). */
export function instantAt(day: CalendarDate, minutes: number): string | null {
  const date = minutes >= DAY_MIN ? addDays(day, 1) : day;
  const rest = minutes >= DAY_MIN ? minutes - DAY_MIN : minutes;
  return wallTimeToInstantStrict({ ...date, hour: Math.floor(rest / 60), minute: rest % 60 }, browserZone());
}

/** Só evento local, com hora, começando e terminando no mesmo dia local e sem conflito/recusa pendente pode ser arrastado. */
export function isDraggable(event: CalendarEventOutput, status: DisplayStatus): boolean {
  if (event.allDay || event.source !== "local" || event.readOnly || status === "conflict" || status === "rejected") return false;
  const start = new Date(event.start), end = new Date(event.end);
  const nextMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
  return end.getTime() <= nextMidnight;
}

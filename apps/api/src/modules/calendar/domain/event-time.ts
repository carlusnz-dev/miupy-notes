import { AppError } from "../../../core/domain/app-error.js";
import type { CalendarEvent } from "./calendar-event.js";

const DAY_MS = 86_400_000;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDate(value: string): boolean {
  if (!dateOnly.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function isValidTimeZone(name: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return name.length > 0 && name.length <= 64; } catch { return false; }
}

export function addDaysToDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const instantPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]([01]\d|2[0-3]):([0-5]\d))$/;
/** Data-hora estrita: data real, hora 00–23, minuto/segundo 00–59 e deslocamento explícito (nunca o fuso do servidor). */
export function parseInstant(text: string): number | null {
  const match = instantPattern.exec(text);
  if (!match || !isRealDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || (match[4] !== undefined && Number(match[4]) > 59)) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export type EventTimes = { allDay: boolean; start: string; end: string; timeZone: string | null };

const invalid = (message: string) => new AppError(400, "VALIDATION_ERROR", message);

/**
 * Normaliza horários na fronteira: com hora vira instante UTC e exige fuso IANA; dia inteiro mantém a data
 * de calendário (sem instante, logo sem desvio de fuso) e dispensa fuso. `end` > `start` com hora; `end` >= `start` por data.
 */
export function normalizeTimes(input: { allDay: boolean; start: string; end: string; timeZone?: string | null }): EventTimes {
  if (input.allDay) {
    if (!isRealDate(input.start) || !isRealDate(input.end)) throw invalid("Datas de dia inteiro devem ser AAAA-MM-DD.");
    if (input.end < input.start) throw invalid("O fim não pode ser anterior ao início.");
    return { allDay: true, start: input.start, end: input.end, timeZone: null };
  }
  if (!input.timeZone || !isValidTimeZone(input.timeZone)) throw invalid("Fuso horário IANA inválido.");
  const start = parseInstant(input.start), end = parseInstant(input.end);
  if (start === null || end === null) throw invalid("Início e fim devem ser data e hora reais, com deslocamento (ex.: 2026-10-21T09:00:00-03:00).");
  if (end <= start) throw invalid("O fim deve ser posterior ao início.");
  return { allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: input.timeZone };
}

/** Intervalo [startsAt, endsAt) em instantes UTC para filtrar/ordenar. Dia inteiro: data de calendário lida como UTC (flutuante). */
export function eventBounds(event: Pick<CalendarEvent, "allDay" | "start" | "end">): { startsAt: string; endsAt: string } {
  if (!event.allDay) return { startsAt: event.start, endsAt: event.end };
  return { startsAt: `${event.start}T00:00:00.000Z`, endsAt: `${addDaysToDate(event.end, 1)}T00:00:00.000Z` };
}

export function overlaps(event: Pick<CalendarEvent, "allDay" | "start" | "end">, from?: string, to?: string): boolean {
  const { startsAt, endsAt } = eventBounds(event);
  return (to === undefined || startsAt < to) && (from === undefined || endsAt > from);
}

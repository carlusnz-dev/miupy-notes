import { addDays, addMonths, fromIso, toIso, weekday, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";

export type ViewMode = "day" | "week" | "month" | "year";
export type Block<T = CalendarEventOutput> = { event: T; startMin: number; endMin: number; column: number; columns: number };

const startOfLocalDay = (date: CalendarDate) => new Date(date.year, date.month - 1, date.day).getTime();
export const weekStart = (date: CalendarDate) => addDays(date, -weekday(date));
export const sameDay = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

/** Início/fim (exclusivo) do período visível, como dias locais; o mês cobre a grade de seis semanas. */
export function visibleDays(mode: ViewMode, anchor: CalendarDate): { first: CalendarDate; endExclusive: CalendarDate } {
  switch (mode) {
    case "day": return { first: anchor, endExclusive: addDays(anchor, 1) };
    case "week": { const first = weekStart(anchor); return { first, endExclusive: addDays(first, 7) }; }
    case "month": { const first = weekStart({ ...anchor, day: 1 }); return { first, endExclusive: addDays(first, 42) }; }
    case "year": return { first: { year: anchor.year, month: 1, day: 1 }, endExclusive: { year: anchor.year + 1, month: 1, day: 1 } };
  }
}

/**
 * Intervalo a pedir à API. Eventos de dia inteiro são datas flutuantes (lidas como UTC no servidor), então o período
 * é ampliado em um dia de cada lado; a exibição filtra de verdade por dia local.
 */
export function apiRange(mode: ViewMode, anchor: CalendarDate): { from: string; to: string } {
  const { first, endExclusive } = visibleDays(mode, anchor);
  return { from: new Date(startOfLocalDay(addDays(first, -1))).toISOString(), to: new Date(startOfLocalDay(addDays(endExclusive, 1))).toISOString() };
}

/** O evento ocupa algum instante deste dia local? Dia inteiro compara datas; com hora, o intervalo [início, fim). */
export function occursOn(event: Pick<CalendarEventOutput, "allDay" | "start" | "end">, day: CalendarDate): boolean {
  const iso = toIso(day);
  if (event.allDay) return event.start <= iso && iso <= event.end;
  const dayStart = startOfLocalDay(day), dayEnd = startOfLocalDay(addDays(day, 1));
  return Date.parse(event.start) < dayEnd && Date.parse(event.end) > dayStart;
}

export function eventsOnDay<T extends CalendarEventOutput>(events: readonly T[], day: CalendarDate): { allDay: T[]; timed: T[] } {
  const matching = events.filter((event) => occursOn(event, day));
  const byStart = (a: T, b: T) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "pt-BR");
  return { allDay: matching.filter((event) => event.allDay).sort(byStart), timed: matching.filter((event) => !event.allDay).sort(byStart) };
}

/** Blocos do cronograma de um dia, em minutos desde 00:00 local, com colunas para eventos sobrepostos. */
export function dayBlocks<T extends CalendarEventOutput>(events: readonly T[], day: CalendarDate): Block<T>[] {
  const dayStart = startOfLocalDay(day);
  const clip = (ms: number) => Math.min(1440, Math.max(0, (ms - dayStart) / 60_000));
  const blocks = eventsOnDay(events, day).timed.map((event) => {
    const startMin = clip(Date.parse(event.start));
    // Altura mínima de 20 min: evento curto continua clicável.
    return { event, startMin, endMin: Math.max(clip(Date.parse(event.end)), Math.min(1440, startMin + 20)), column: 0, columns: 1 };
  }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  let cluster: Block<T>[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columnEnds: number[] = [];
    for (const block of cluster) {
      let column = columnEnds.findIndex((end) => end <= block.startMin);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = block.endMin;
      block.column = column;
    }
    for (const block of cluster) block.columns = columnEnds.length;
    cluster = [];
  };
  for (const block of blocks) {
    if (cluster.length > 0 && block.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  flush();
  return blocks;
}

/** Próximos eventos a partir de `now`: já em andamento ou futuros, por início, limitados a `limit`. */
export function upcomingEvents<T extends CalendarEventOutput>(events: readonly T[], now: Date, limit: number): T[] {
  const today = toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  return events
    .filter((event) => (event.allDay ? event.end >= today : Date.parse(event.end) > now.getTime()))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, "pt-BR"))
    .slice(0, limit);
}
// Compara dia inteiro e com hora na mesma régua: data local de início + hora (dia inteiro vem antes).
function sortKey(event: CalendarEventOutput): string {
  if (event.allDay) return `${event.start}T00:00`;
  const date = new Date(event.start);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function monthGrid(anchor: CalendarDate): CalendarDate[][] {
  const { first } = visibleDays("month", anchor);
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day)));
}

export function shift(mode: ViewMode, anchor: CalendarDate, direction: -1 | 1): CalendarDate {
  switch (mode) {
    case "day": return addDays(anchor, direction);
    case "week": return addDays(anchor, direction * 7);
    case "month": return addMonths(anchor, direction);
    case "year": return addMonths(anchor, direction * 12);
  }
}

export function parseAnchor(iso: string | null): CalendarDate | null { return iso ? fromIso(iso) : null; }

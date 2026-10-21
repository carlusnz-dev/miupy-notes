import { addDays, compare, monthNames, todayLocal, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { visibleDays, type ViewMode } from "./layout";
import { browserZone, wallClock, wallTimeInZone } from "./time";

const cap = (text: string) => text[0].toUpperCase() + text.slice(1);
const short = (index: number) => monthNames[index].slice(0, 3);
const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const monthTitle = (month: number) => cap(monthNames[month - 1]);

/** Horário no relógio do navegador, que é o da grade; dia inteiro não tem horário. */
export function timeRange(event: Pick<CalendarEventOutput, "allDay" | "start" | "end">): string {
  if (event.allDay) return "Dia inteiro";
  return `${clock.format(new Date(event.start))}–${clock.format(new Date(event.end))}`;
}

/** Quando o evento foi marcado em outro fuso, mostra o horário nele ("09:00 em America/Sao_Paulo"). */
export function zoneNote(event: Pick<CalendarEventOutput, "allDay" | "start" | "timeZone">): string | null {
  if (event.allDay || !event.timeZone || event.timeZone === browserZone()) return null;
  const here = wallTimeInZone(event.start, browserZone());
  const there = wallTimeInZone(event.start, event.timeZone);
  return here.hour === there.hour && here.minute === there.minute ? null : `${wallClock(there)} em ${event.timeZone}`;
}

export function relativeDay(date: CalendarDate, today = todayLocal()): string {
  const diff = compare(date, today);
  if (diff === 0) return "Hoje";
  if (compare(date, addDays(today, 1)) === 0) return "Amanhã";
  return `${weekdayNames[new Date(date.year, date.month - 1, date.day).getDay()].slice(0, 3)}., ${date.day} ${short(date.month - 1)}`;
}

export function periodLabel(mode: ViewMode, anchor: CalendarDate): string {
  if (mode === "day") return `${cap(weekdayNames[new Date(anchor.year, anchor.month - 1, anchor.day).getDay()])}, ${anchor.day} de ${monthNames[anchor.month - 1]} de ${anchor.year}`;
  if (mode === "month") return `${monthTitle(anchor.month)} de ${anchor.year}`;
  if (mode === "year") return String(anchor.year);
  const { first } = visibleDays("week", anchor);
  const last = addDays(first, 6);
  return first.month === last.month ? `${first.day}–${last.day} de ${monthNames[last.month - 1]} de ${last.year}` : `${first.day} ${short(first.month - 1)} – ${last.day} ${short(last.month - 1)} ${last.year}`;
}

/** Dia local de início de um evento (para agrupar a lista de próximos). */
export function startDay(event: Pick<CalendarEventOutput, "allDay" | "start">): CalendarDate {
  if (event.allDay) return { year: +event.start.slice(0, 4), month: +event.start.slice(5, 7), day: +event.start.slice(8, 10) };
  const date = new Date(event.start);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

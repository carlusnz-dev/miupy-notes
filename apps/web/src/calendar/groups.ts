import type { CalendarEventOutput } from "../lib/calendar-api";
import { startDay } from "./format";
import { toIso } from "../lib/calendar-date";

/** Ocorrências do mesmo evento repetido em dias diferentes, em ordem cronológica. */
export type EventGroup<T extends CalendarEventOutput = CalendarEventOutput> = { key: string; events: T[] };

const pad = (value: number) => String(value).padStart(2, "0");
const clockOf = (iso: string) => { const date = new Date(iso); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };

/**
 * Critério da série: o modelo da API não tem `recurringEventId` (o espelho vem expandido, sem o ID da série), então
 * agrupa por origem + título + horário local + local. Dois eventos no mesmo dia nunca formam uma série.
 */
export function seriesKey(event: CalendarEventOutput): string {
  const when = event.allDay ? "dia-inteiro" : `${clockOf(event.start)}-${clockOf(event.end)}`;
  return [event.source, event.title.trim().toLocaleLowerCase("pt-BR"), when, event.location.trim().toLocaleLowerCase("pt-BR")].join("|");
}

/** Agrupa mantendo a ordem de `events` (já cronológica): cada grupo ocupa a posição da sua primeira ocorrência. */
export function groupEvents<T extends CalendarEventOutput>(events: readonly T[]): EventGroup<T>[] {
  const groups: EventGroup<T>[] = [];
  const byKey = new Map<string, { group: EventGroup<T>; days: Set<string> }>();
  for (const event of events) {
    const key = seriesKey(event);
    const day = toIso(startDay(event));
    const found = byKey.get(key);
    if (found && !found.days.has(day)) { found.group.events.push(event); found.days.add(day); continue; }
    if (found) { groups.push({ key: `${key}#${event.id}`, events: [event] }); continue; }
    const group = { key, events: [event] };
    groups.push(group);
    byKey.set(key, { group, days: new Set([day]) });
  }
  return groups;
}

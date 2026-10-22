import type { CalendarEventOutput, EventDraft, EventLink } from "../lib/calendar-api";
import { browserZone, parseWall, wallClock, wallDate, wallTimeInZone, wallTimeToInstantStrict } from "./time";

const roundedStart = (day: { year: number; month: number; day: number }, now = new Date()) => {
  const same = now.getFullYear() === day.year && now.getMonth() + 1 === day.month && now.getDate() === day.day;
  return { ...day, hour: same ? Math.min(23, now.getHours() + 1) : 9, minute: 0 };
};

export type Fields = { title: string; description: string; location: string; allDay: boolean; startDate: string; startTime: string; endDate: string; endTime: string; timeZone: string; links: EventLink[] };

export function initialFields(event: CalendarEventOutput | null, day: { year: number; month: number; day: number }): Fields {
  if (event?.allDay) return { title: event.title, description: event.description, location: event.location, allDay: true, startDate: event.start, startTime: "09:00", endDate: event.end, endTime: "10:00", timeZone: browserZone(), links: event.links };
  if (event) {
    const zone = event.timeZone ?? browserZone();
    const start = wallTimeInZone(event.start, zone), end = wallTimeInZone(event.end, zone);
    return { title: event.title, description: event.description, location: event.location, allDay: false, startDate: wallDate(start), startTime: wallClock(start), endDate: wallDate(end), endTime: wallClock(end), timeZone: zone, links: event.links };
  }
  const start = roundedStart(day);
  return { title: "", description: "", location: "", allDay: false, startDate: wallDate(start), startTime: wallClock(start), endDate: wallDate(start), endTime: wallClock({ hour: Math.min(23, start.hour + 1), minute: 0 }), timeZone: browserZone(), links: [] };
}

/** Converte os campos do formulário no rascunho da API; devolve a mensagem de erro em vez de enviar dados inválidos. */
export function buildDraft(fields: Fields): { draft: EventDraft } | { error: string } {
  const title = fields.title.trim();
  if (!title) return { error: "Informe um título." };
  const base = { title, description: fields.description, location: fields.location.trim(), links: fields.links };
  if (fields.allDay) {
    if (!fields.startDate || !fields.endDate) return { error: "Informe as datas de início e fim." };
    if (fields.endDate < fields.startDate) return { error: "O fim não pode ser anterior ao início." };
    return { draft: { ...base, allDay: true, start: fields.startDate, end: fields.endDate, timeZone: null } };
  }
  const start = parseWall(fields.startDate, fields.startTime), end = parseWall(fields.endDate, fields.endTime);
  if (!start || !end) return { error: "Informe data e hora de início e de fim." };
  // Ida e volta: horário que não existe no fuso (salto do horário de verão) é erro, não ajuste silencioso.
  const startAt = wallTimeToInstantStrict(start, fields.timeZone), endAt = wallTimeToInstantStrict(end, fields.timeZone);
  if (startAt === null || endAt === null) return { error: `Esse horário não existe em ${fields.timeZone} (salto do horário de verão). Escolha outro horário ou outro fuso.` };
  if (endAt <= startAt) return { error: "O fim deve ser posterior ao início." };
  return { draft: { ...base, allDay: false, start: startAt, end: endAt, timeZone: fields.timeZone } };
}


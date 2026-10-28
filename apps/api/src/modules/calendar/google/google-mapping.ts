import { createHash } from "node:crypto";
import { CalendarEvent, type ExternalRef } from "../domain/calendar-event.js";
import { addDaysToDate, isRealDate, isValidTimeZone } from "../domain/event-time.js";
import type { GoogleEvent, GoogleEventBody } from "./google-calendar.client.js";

/** Marca gravada em `extendedProperties.private` dos eventos que o app enviou, para não reimportá-los como espelho. */
export const OWN_EVENT_PROPERTY = "miupyEventId";

/** UUID determinístico do espelho: reimportar o mesmo evento do Google sempre grava o mesmo item (sem duplicata). */
export function mirrorId(ownerId: string, calendarId: string, externalId: string): string {
  const hex = createHash("sha256").update(`google\u0000${ownerId}\u0000${calendarId}\u0000${externalId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "89ab"[parseInt(hex[16], 16) % 4];
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

/** ID de evento do Google derivado do UUID local: base32hex (0-9a-v) tem 32 chars, dentro do limite de 5–1024. */
export const googleIdFor = (eventId: string) => eventId.replaceAll("-", "");
/** Inverso de `googleIdFor`: itens cancelados da sincronização incremental só garantem o `id`. `null` se não for um UUID sem hífens. */
export const eventIdFromGoogle = (googleId: string) => /^[0-9a-f]{32}$/.test(googleId) ? `${googleId.slice(0, 8)}-${googleId.slice(8, 12)}-${googleId.slice(12, 16)}-${googleId.slice(16, 20)}-${googleId.slice(20)}` : null;

export function toGoogleBody(event: CalendarEvent): GoogleEventBody {
  const body: GoogleEventBody = {
    id: googleIdFor(event.id),
    summary: event.title,
    description: event.description,
    location: event.location,
    extendedProperties: { private: { [OWN_EVENT_PROPERTY]: event.id } },
    // Dia inteiro: no Google `end.date` é exclusivo.
    ...(event.allDay
      ? { start: { date: event.start }, end: { date: addDaysToDate(event.end, 1) } }
      : { start: { dateTime: event.start, timeZone: event.timeZone ?? "UTC" }, end: { dateTime: event.end, timeZone: event.timeZone ?? "UTC" } }),
  };
  return body;
}

/** O conteúdo remoto já é o que enviaríamos? Usado para reconciliar um envio cuja resposta se perdeu. */
export function sameRemoteContent(remote: GoogleEvent, body: GoogleEventBody): boolean {
  const instant = (time?: { dateTime?: string }) => (time?.dateTime ? new Date(time.dateTime).toISOString() : undefined);
  return (remote.summary ?? "") === (body.summary ?? "") && (remote.description ?? "") === (body.description ?? "") && (remote.location ?? "") === (body.location ?? "")
    && remote.start?.date === body.start?.date && remote.end?.date === body.end?.date
    && instant(remote.start) === instant(body.start) && instant(remote.end) === instant(body.end);
}

export type MirrorContext = { ownerId: string; calendarId: string; connectionId: string; calendarTimeZone?: string; syncedAt: string; existing: CalendarEvent | null };

/** Converte um evento do Google em espelho. `null` se não for representável (sem datas) — nunca inventa horário. */
export function toMirrorEvent(google: GoogleEvent, ctx: MirrorContext): CalendarEvent | null {
  const startDate = google.start?.date, endDate = google.end?.date;
  const external: ExternalRef = { provider: "google", calendarId: ctx.calendarId, externalId: google.id, etag: google.etag ?? "", syncedAt: ctx.syncedAt, connectionId: ctx.connectionId };
  const id = mirrorId(ctx.ownerId, ctx.calendarId, google.id);
  const createdAt = ctx.existing?.createdAt ?? ctx.syncedAt;
  const common = [(google.summary?.trim() || "(sem título)").slice(0, 200), (google.description ?? "").slice(0, 8_000), (google.location ?? "").trim().slice(0, 300)] as const;
  const version = (ctx.existing?.version ?? 0) + 1;
  if (startDate && endDate && isRealDate(startDate) && isRealDate(endDate)) {
    const last = addDaysToDate(endDate, -1);
    return new CalendarEvent(id, ctx.ownerId, ...common, true, startDate, last < startDate ? startDate : last, null, [], "google", external, null, createdAt, ctx.syncedAt, version);
  }
  const start = google.start?.dateTime ? Date.parse(google.start.dateTime) : Number.NaN;
  const end = google.end?.dateTime ? Date.parse(google.end.dateTime) : Number.NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const zone = [google.start?.timeZone, ctx.calendarTimeZone].find((name): name is string => !!name && isValidTimeZone(name)) ?? "UTC";
  return new CalendarEvent(id, ctx.ownerId, ...common, false, new Date(start).toISOString(), new Date(Math.max(start, end)).toISOString(), zone, [], "google", external, null, createdAt, ctx.syncedAt, version);
}

/** Recorte do recurso `Event` da Calendar API v3 usado aqui; campos além destes são ignorados. */
export type GoogleEventTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
};
export type GoogleEventBody = Omit<GoogleEvent, "id" | "etag" | "status"> & { id?: string };
export type GoogleEventsPage = { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string };
export type ListParams = { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string };

export type GoogleErrorKind =
  | "gone"                 // 410: syncToken inválido (`fullSyncRequired`)
  | "precondition_failed"  // 412: ETag do If-Match não confere
  | "conflict"             // 409: ID de evento já existe
  | "not_found"            // 404
  | "rate_limited"         // 429 ou 403 rateLimitExceeded/userRateLimitExceeded
  | "unauthorized"         // 401 ou refresh token recusado: precisa reautorizar
  | "insufficient_scope"   // 403 insufficientPermissions: o token não tem o escopo (ex.: login refeito só com leitura)
  | "forbidden"            // demais 403: recusa definitiva, não adianta repetir
  | "unavailable"          // 5xx ou falha de rede
  | "invalid";             // demais 4xx

/** Erro do provedor reduzido a uma classificação; nunca carrega corpo, token ou texto do Google. */
export class GoogleApiError extends Error {
  constructor(public readonly kind: GoogleErrorKind, public readonly retryAfterMs?: number) {
    super(`google:${kind}`);
  }
}

/** Fronteira com a Calendar API. `ownerId` escolhe as credenciais; a implementação real é HTTP, os testes usam fake. */
export abstract class GoogleCalendarClient {
  abstract listEvents(ownerId: string, calendarId: string, params: ListParams): Promise<GoogleEventsPage>;
  abstract getEvent(ownerId: string, calendarId: string, eventId: string): Promise<GoogleEvent>;
  abstract insertEvent(ownerId: string, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent>;
  abstract updateEvent(ownerId: string, calendarId: string, eventId: string, body: GoogleEventBody, etag: string): Promise<GoogleEvent>;
  abstract deleteEvent(ownerId: string, calendarId: string, eventId: string, etag: string): Promise<void>;
}

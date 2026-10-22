import { GoogleApiError, GoogleCalendarClient, type GoogleEvent, type GoogleEventBody, type GoogleEventsPage, type ListParams } from "./google-calendar.client.js";

/**
 * Google falso em memória, só para testes e desenvolvimento sem conta: pagina com tokens, entrega
 * `nextSyncToken` na última página, invalida tokens (410), versiona ETag e aplica If-Match.
 */
export class FakeGoogleCalendarClient extends GoogleCalendarClient {
  readonly events = new Map<string, GoogleEvent>();
  readonly calls: string[] = [];
  pageSize = 2;
  calendarTimeZone = "America/Sao_Paulo";
  /** Tokens aceitos em sync incremental: token → posição do log de mudanças. */
  private readonly log: GoogleEvent[] = [];
  private readonly validTokens = new Set<string>();
  /** Falhas programadas por operação (consumidas em ordem). */
  readonly failures: Record<string, GoogleApiError[]> = {};
  private etagCounter = 0;

  seed(event: GoogleEvent): GoogleEvent {
    const stored = { ...event, etag: `"e${++this.etagCounter}"`, status: event.status ?? "confirmed" } as GoogleEvent;
    this.events.set(stored.id, stored);
    this.log.push(stored);
    return stored;
  }

  remove(id: string) {
    const gone = { ...this.events.get(id)!, status: "cancelled" as const };
    this.events.delete(id);
    this.log.push(gone);
  }

  invalidateTokens() { this.validTokens.clear(); }

  private fail(operation: string) {
    const next = this.failures[operation]?.shift();
    if (next) throw next;
  }

  async listEvents(_ownerId: string, _calendarId: string, params: ListParams): Promise<GoogleEventsPage> {
    this.calls.push(`list:${params.syncToken ? "sync" : "full"}:${params.pageToken ?? ""}`);
    this.fail("list");
    let source: GoogleEvent[];
    if (params.syncToken) {
      if (!this.validTokens.has(params.syncToken)) throw new GoogleApiError("gone");
      source = this.log.slice(Number(params.syncToken.split(":")[1]));
    } else {
      source = [...this.events.values()];
    }
    const offset = params.pageToken ? Number(params.pageToken) : 0;
    const items = source.slice(offset, offset + this.pageSize);
    if (offset + this.pageSize < source.length) return { items, nextPageToken: String(offset + this.pageSize), timeZone: this.calendarTimeZone };
    const token = `sync:${this.log.length}`;
    this.validTokens.add(token);
    return { items, nextSyncToken: token, timeZone: this.calendarTimeZone };
  }

  async getEvent(_o: string, _c: string, eventId: string): Promise<GoogleEvent> {
    this.calls.push(`get:${eventId}`);
    this.fail("get");
    const found = this.events.get(eventId);
    if (!found) throw new GoogleApiError("not_found");
    return found;
  }

  async insertEvent(_o: string, _c: string, body: GoogleEventBody): Promise<GoogleEvent> {
    this.calls.push("insert");
    this.fail("insert");
    if (!body.id) throw new GoogleApiError("invalid");
    if (this.events.has(body.id)) throw new GoogleApiError("conflict");
    return this.seed({ ...body, id: body.id });
  }

  async updateEvent(_o: string, _c: string, eventId: string, body: GoogleEventBody, etag: string): Promise<GoogleEvent> {
    this.calls.push("update");
    this.fail("update");
    const current = this.events.get(eventId);
    if (!current) throw new GoogleApiError("not_found");
    if (current.etag !== etag) throw new GoogleApiError("precondition_failed");
    return this.seed({ ...current, ...body, id: eventId });
  }

  async deleteEvent(_o: string, _c: string, eventId: string, etag: string): Promise<void> {
    this.calls.push("delete");
    this.fail("delete");
    const current = this.events.get(eventId);
    if (!current) throw new GoogleApiError("not_found");
    if (current.etag !== etag) throw new GoogleApiError("precondition_failed");
    this.remove(eventId);
  }
}

import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import { GoogleApiError, GoogleCalendarClient, type GoogleEvent, type GoogleEventBody, type GoogleEventsPage, type ListParams } from "./google-calendar.client.js";
import type { AccessTokenSource, FetchLike } from "./google-oauth.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars";
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

const timeSchema = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
const eventSchema = z.object({
  id: z.string(), status: z.enum(["confirmed", "tentative", "cancelled"]).optional(), etag: z.string().optional(),
  summary: z.string().optional(), description: z.string().optional(), location: z.string().optional(),
  start: timeSchema.optional(), end: timeSchema.optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
const pageSchema = z.object({ items: z.array(eventSchema).default([]), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional(), timeZone: z.string().optional() });
const errorSchema = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().optional() })).optional() }).optional() });

type Options = { tokens: AccessTokenSource; doFetch?: FetchLike; sleep?: (ms: number) => Promise<void>; random?: () => number };

/**
 * Cliente HTTP da Calendar API. Segue a documentação oficial: 429 e 403 `rateLimitExceeded` repetem com
 * backoff exponencial e jitter (respeita `Retry-After`); 410 vira `gone`; 412 vira `precondition_failed`.
 */
export class HttpGoogleCalendarClient extends GoogleCalendarClient {
  private readonly tokens: AccessTokenSource;
  private readonly doFetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: Options) {
    super();
    this.tokens = options.tokens;
    this.doFetch = options.doFetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  async listEvents(ownerId: string, calendarId: string, params: ListParams): Promise<GoogleEventsPage> {
    const query = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    // Com syncToken, timeMin/timeMax/orderBy/q... são proibidos (400); o conjunto de parâmetros é o mesmo em todas as páginas.
    if (params.syncToken) query.set("syncToken", params.syncToken);
    else {
      if (params.timeMin) query.set("timeMin", params.timeMin);
      if (params.timeMax) query.set("timeMax", params.timeMax);
    }
    if (params.pageToken) query.set("pageToken", params.pageToken);
    return pageSchema.parse(await this.call(ownerId, "GET", `${this.events(calendarId)}?${query}`));
  }

  async getEvent(ownerId: string, calendarId: string, eventId: string): Promise<GoogleEvent> {
    return eventSchema.parse(await this.call(ownerId, "GET", `${this.events(calendarId)}/${encodeURIComponent(eventId)}`));
  }

  async insertEvent(ownerId: string, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent> {
    return eventSchema.parse(await this.call(ownerId, "POST", `${this.events(calendarId)}?sendUpdates=none`, body));
  }

  async updateEvent(ownerId: string, calendarId: string, eventId: string, body: GoogleEventBody, etag: string): Promise<GoogleEvent> {
    // PATCH conserva convidados, lembretes, recorrência e metadados que este formulário não edita.
    const { id: _id, ...fields } = body;
    const clearOtherKind = (value: GoogleEvent["start"]) => value?.date ? { ...value, dateTime: null, timeZone: null } : { ...value, date: null };
    return eventSchema.parse(await this.call(ownerId, "PATCH", `${this.events(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`, { ...fields, ...(body.start ? { start: clearOtherKind(body.start) } : {}), ...(body.end ? { end: clearOtherKind(body.end) } : {}) }, etag));
  }

  async deleteEvent(ownerId: string, calendarId: string, eventId: string, etag: string): Promise<void> {
    await this.call(ownerId, "DELETE", `${this.events(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`, undefined, etag);
  }

  private events(calendarId: string) { return `${BASE}/${encodeURIComponent(calendarId)}/events`; }

  private async call(ownerId: string, method: string, url: string, body?: unknown, etag?: string): Promise<unknown> {
    let refreshedAfter401 = false;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        const headers: Record<string, string> = { authorization: `Bearer ${await this.tokens.get(ownerId)}` };
        if (body !== undefined) headers["content-type"] = "application/json";
        if (etag) headers["if-match"] = etag;
        response = await this.doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        if (error instanceof GoogleApiError || error instanceof AppError) throw error;
        if (attempt >= MAX_ATTEMPTS) throw new GoogleApiError("unavailable");
        await this.sleep(this.delay(attempt));
        continue;
      }
      if (response.ok) return response.status === 204 ? null : await response.json();

      const reason = await this.reason(response);
      const retryAfterMs = this.retryAfter(response);
      if (response.status === 401 && !refreshedAfter401) {
        // Access token revogado/expirado antes do previsto: renova uma vez; se o refresh falhar, vira `unauthorized`.
        refreshedAfter401 = true;
        this.tokens.invalidate(ownerId);
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500 || (response.status === 403 && reason !== undefined && RETRYABLE_REASONS.has(reason));
      // Esperas longas voltam à API com o prazo intacto, sem prender a requisição HTTP ou antecipar o provedor.
      if (retryable && attempt < MAX_ATTEMPTS && (retryAfterMs ?? 0) <= MAX_DELAY_MS) { await this.sleep(retryAfterMs ?? this.delay(attempt)); continue; }
      throw new GoogleApiError(this.kind(response.status, reason), retryAfterMs);
    }
  }

  private kind(status: number, reason: string | undefined): GoogleApiError["kind"] {
    if (status === 410) return "gone";
    if (status === 412) return "precondition_failed";
    if (status === 409) return "conflict";
    if (status === 404) return "not_found";
    if (status === 401) return "unauthorized";
    if (status === 429 || (status === 403 && reason !== undefined && (RETRYABLE_REASONS.has(reason) || reason === "quotaExceeded"))) return "rate_limited";
    if (status >= 500) return "unavailable";
    return "invalid";
  }

  private delay(attempt: number) { return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1)) + Math.floor(this.random() * 250); }

  private retryAfter(response: Response): number | undefined {
    const raw = response.headers.get("retry-after");
    if (raw === null) return undefined;
    const ms = /^\d+$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
    return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  }

  private async reason(response: Response): Promise<string | undefined> {
    try { return errorSchema.parse(await response.json()).error?.errors?.[0]?.reason; } catch { return undefined; }
  }
}

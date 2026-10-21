import { randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { CalendarEvent } from "../domain/calendar-event.js";
import type { GoogleConnection, GoogleMode } from "../domain/google-connection.js";
import type { AuthorizeGoogleInput, ConnectGoogleInput } from "../dto/input.js";
import type { GoogleStatusOutput, GoogleSyncOutput } from "../dto/output.js";
import { GoogleApiError, type GoogleCalendarClient, type GoogleEvent } from "../google/google-calendar.client.js";
import { OWN_EVENT_PROPERTY, googleIdFor, mirrorId, sameRemoteContent, toGoogleBody, toMirrorEvent } from "../google/google-mapping.js";
import { SCOPE_MIRROR, SCOPE_REFLECT, type CredentialStore, type GoogleOAuth } from "../google/google-oauth.js";
import { CalendarRepository } from "../repository/calendar.repository.js";
import { GoogleIntegrationService } from "./google-integration.service.js";

export type GoogleIntegrationDeps = { oauth: GoogleOAuth; credentials: CredentialStore; client: GoogleCalendarClient };

const CALENDAR_ID = "primary";
const AUTHORIZATION_TTL_MS = 10 * 60_000;
/** Teto de páginas por sincronização: acima disso o cursor não é gravado e o usuário vê o erro, em vez de um espelho parcial "em dia". */
const MAX_PAGES = 40;
/** Janela da primeira sincronização completa (o Google proíbe `timeMin` nas incrementais, então ela só vale aqui). */
const FULL_SYNC_PAST_DAYS = 30;

const notConfigured = () => new AppError(409, "INTEGRATION_NOT_CONFIGURED", "A integração com o Google Calendar não está configurada neste servidor.");
const notConnected = () => new AppError(409, "INTEGRATION_NOT_CONNECTED", "Conecte o Google Calendar antes de continuar.");
const reauth = () => new AppError(409, "REAUTH_REQUIRED", "O Google recusou o acesso. Conecte o Google Calendar de novo.");
const googleConflict = () => new AppError(409, "GOOGLE_CONFLICT", "O evento mudou no Google depois do último envio. Nada foi sobrescrito.");
const versionConflict = () => new AppError(409, "CONFLICT", "O evento foi alterado por outra operação. Recarregue e tente de novo.");

const scopesFor = (mode: GoogleMode) => (mode === "reflect" ? [SCOPE_REFLECT] : [SCOPE_MIRROR]);
const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class GoogleIntegrationServiceImpl extends GoogleIntegrationService {
  constructor(repository: CalendarRepository, private readonly google: GoogleIntegrationDeps | null, private readonly now: () => Date = () => new Date()) { super(repository); }

  async status(ownerId: string): Promise<GoogleStatusOutput> {
    const connection = this.google ? await this.repository.getConnection(ownerId) : null;
    return {
      state: !this.google ? "not_configured" : !connection ? "not_connected" : connection.status,
      mode: connection?.mode ?? null, scopes: [...(connection?.scopes ?? [])], calendarId: connection?.calendarId ?? null,
      connectedAt: connection?.connectedAt ?? null, lastSyncAt: connection?.lastSyncAt ?? null, lastError: connection?.lastError ?? null,
      hasSyncCursor: connection?.syncToken != null,
    };
  }

  async authorize(ownerId: string, input: AuthorizeGoogleInput) {
    const google = this.require();
    const state = randomBytes(24).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + AUTHORIZATION_TTL_MS).toISOString();
    await this.repository.savePending(ownerId, { state, mode: input.mode, redirectUri: input.redirectUri, expiresAt });
    return { authorizationUrl: google.oauth.authorizationUrl({ state, codeChallenge: input.codeChallenge, redirectUri: input.redirectUri, scopes: scopesFor(input.mode) }), state, expiresAt };
  }

  async connect(ownerId: string, input: ConnectGoogleInput): Promise<GoogleStatusOutput> {
    const google = this.require();
    const pending = await this.repository.getPending(ownerId);
    // Uso único: some antes da troca, então um `code` repetido não passa duas vezes.
    await this.repository.clearPending(ownerId);
    if (!pending || pending.expiresAt <= this.now().toISOString() || !sameSecret(pending.state, input.state) || pending.redirectUri !== input.redirectUri) {
      throw new AppError(400, "VALIDATION_ERROR", "Autorização inválida ou expirada. Comece de novo.");
    }
    let grant;
    try { grant = await google.oauth.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier, redirectUri: input.redirectUri }); }
    catch (error) { throw this.translate(error); }
    // Consentimento granular: o usuário pode desmarcar o escopo; sem ele não há conexão.
    if (!scopesFor(pending.mode).every((scope) => grant.scopes.includes(scope))) {
      await google.oauth.revoke(grant.refreshToken);
      throw new AppError(409, "SCOPE_NOT_GRANTED", "O acesso pedido ao Google Calendar não foi concedido.");
    }
    await google.credentials.put(ownerId, grant.refreshToken);
    await this.repository.saveConnection(ownerId, {
      status: "connected", mode: pending.mode, scopes: grant.scopes, calendarId: CALENDAR_ID,
      connectedAt: this.now().toISOString(), syncToken: null, lastSyncAt: null, lastError: null,
    });
    return this.status(ownerId);
  }

  async disconnect(ownerId: string): Promise<GoogleStatusOutput> {
    const google = this.require();
    const token = await google.credentials.get(ownerId);
    if (token) await google.oauth.revoke(token);
    await google.credentials.delete(ownerId);
    await this.repository.deleteConnection(ownerId);
    await this.repository.clearPending(ownerId);
    // Os espelhos saem junto: sem conexão não há como mantê-los atualizados. Cópias enviadas ao Google permanecem lá.
    await this.repository.deleteAllMirrors(ownerId);
    return this.status(ownerId);
  }

  async sync(ownerId: string): Promise<GoogleSyncOutput> {
    const google = this.require();
    const connection = await this.connected(ownerId);
    try {
      let resynced = false;
      let result: Omit<GoogleSyncOutput, "resynced" | "lastSyncAt"> & { syncToken: string };
      try {
        result = await this.pull(google, ownerId, connection, connection.syncToken);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.kind !== "gone") throw error;
        // 410: o cursor perdeu a validade. Apaga o espelho e refaz a sincronização completa, como a documentação manda.
        await this.repository.deleteAllMirrors(ownerId);
        resynced = true;
        result = await this.pull(google, ownerId, connection, null);
      }
      const lastSyncAt = this.now().toISOString();
      await this.repository.saveConnection(ownerId, { ...connection, syncToken: result.syncToken, lastSyncAt, lastError: null });
      return { kind: result.kind, pages: result.pages, upserted: result.upserted, deleted: result.deleted, resynced, lastSyncAt };
    } catch (error) {
      throw await this.failed(ownerId, connection, error);
    }
  }

  async reflect(ownerId: string, eventId: string): Promise<CalendarEvent> {
    const google = this.require();
    const connection = await this.connected(ownerId);
    if (connection.mode !== "reflect") throw new AppError(409, "REFLECTION_NOT_ENABLED", "Conecte o Google Calendar com permissão de escrita para enviar eventos.");
    const event = await this.local(ownerId, eventId);
    const body = toGoogleBody(event);
    const googleId = googleIdFor(event.id);
    try {
      const remote = event.reflection ? await this.update(google, ownerId, event, body) : await this.insert(google, ownerId, googleId, body);
      const saved = await this.repository.update(this.withReflection(event, { googleEventId: googleId, calendarId: CALENDAR_ID, etag: remote.etag ?? "", reflectedVersion: event.version + 1, reflectedAt: this.now().toISOString() }), event.version);
      // O Google já tem o evento; o próximo envio reconcilia pelo conteúdo, então perder esta corrida não duplica nada.
      if (!saved) throw versionConflict();
      return saved;
    } catch (error) {
      throw await this.failed(ownerId, connection, error, false);
    }
  }

  async unreflect(ownerId: string, eventId: string, options: { keepRemote: boolean }): Promise<CalendarEvent> {
    const event = await this.local(ownerId, eventId);
    if (!event.reflection) return event;
    if (!options.keepRemote) {
      const google = this.require();
      const connection = await this.connected(ownerId);
      try {
        await google.client.deleteEvent(ownerId, event.reflection.calendarId, event.reflection.googleEventId, event.reflection.etag);
      } catch (error) {
        // 404: já não existe no Google, o objetivo está cumprido.
        if (!(error instanceof GoogleApiError && error.kind === "not_found")) throw await this.failed(ownerId, connection, error, false);
      }
    }
    const next = this.withReflection(event, null);
    const saved = await this.repository.update(next, event.version);
    if (!saved) throw versionConflict();
    return saved;
  }

  private require(): GoogleIntegrationDeps {
    if (!this.google) throw notConfigured();
    return this.google;
  }

  private async connected(ownerId: string): Promise<GoogleConnection> {
    const connection = await this.repository.getConnection(ownerId);
    if (!connection) throw notConnected();
    if (connection.status === "needs_reauth") throw reauth();
    return connection;
  }

  private async local(ownerId: string, eventId: string): Promise<CalendarEvent> {
    const event = await this.repository.findById(ownerId, eventId);
    if (!event) throw new AppError(404, "NOT_FOUND", "Evento não encontrado.");
    if (event.source !== "local") throw new AppError(409, "READ_ONLY_EVENT", "Eventos espelhados do Google são somente leitura.");
    return event;
  }

  private withReflection(event: CalendarEvent, reflection: CalendarEvent["reflection"]): CalendarEvent {
    return new CalendarEvent(event.id, event.ownerId, event.title, event.description, event.location, event.allDay, event.start, event.end, event.timeZone, event.links, event.source, event.external, reflection, event.createdAt, this.now().toISOString(), event.version + 1);
  }

  private async insert(google: GoogleIntegrationDeps, ownerId: string, googleId: string, body: ReturnType<typeof toGoogleBody>): Promise<GoogleEvent> {
    try {
      return await google.client.insertEvent(ownerId, CALENDAR_ID, body);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== "conflict") throw error;
      // O ID é derivado do evento: 409 significa que uma tentativa anterior chegou ao Google. Reconcilia em vez de duplicar.
      const remote = await google.client.getEvent(ownerId, CALENDAR_ID, googleId);
      if (sameRemoteContent(remote, body)) return remote;
      return google.client.updateEvent(ownerId, CALENDAR_ID, googleId, body, remote.etag ?? "");
    }
  }

  private async update(google: GoogleIntegrationDeps, ownerId: string, event: CalendarEvent, body: ReturnType<typeof toGoogleBody>): Promise<GoogleEvent> {
    const reflection = event.reflection!;
    try {
      return await google.client.updateEvent(ownerId, reflection.calendarId, reflection.googleEventId, body, reflection.etag);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== "precondition_failed") throw error;
      // 412 pode ser só uma gravação anterior cuja resposta se perdeu: se o remoto já tem este conteúdo, adota o ETag novo.
      const remote = await google.client.getEvent(ownerId, reflection.calendarId, reflection.googleEventId);
      if (sameRemoteContent(remote, body)) return remote;
      throw error;
    }
  }

  private async pull(google: GoogleIntegrationDeps, ownerId: string, connection: GoogleConnection, syncToken: string | null) {
    const kind = syncToken ? "incremental" as const : "full" as const;
    const timeMin = kind === "full" ? new Date(this.now().getTime() - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString() : undefined;
    let pageToken: string | undefined;
    let pages = 0, upserted = 0, deleted = 0;
    for (;;) {
      if (pages >= MAX_PAGES) throw new AppError(502, "SYNC_TOO_LARGE", "A sincronização excedeu o limite de páginas. Nada foi marcado como em dia.");
      const page = await google.client.listEvents(ownerId, connection.calendarId, { syncToken: syncToken ?? undefined, pageToken, timeMin });
      pages++;
      for (const item of page.items) {
        const outcome = await this.apply(ownerId, connection.calendarId, page.timeZone, item);
        if (outcome === "upserted") upserted++; else if (outcome === "deleted") deleted++;
      }
      if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
      // O token novo só vem na última página; sem ele não dá para afirmar que o espelho está completo.
      if (!page.nextSyncToken) throw new AppError(502, "SYNC_INCOMPLETE", "O Google não devolveu o cursor de sincronização.");
      return { kind, pages, upserted, deleted, syncToken: page.nextSyncToken };
    }
  }

  private async apply(ownerId: string, calendarId: string, calendarTimeZone: string | undefined, item: GoogleEvent): Promise<"upserted" | "deleted" | "skipped"> {
    // Cópia que o próprio app enviou: o original local é a fonte, não se reimporta como espelho.
    if (item.extendedProperties?.private?.[OWN_EVENT_PROPERTY]) return this.refreshOwnEtag(ownerId, item);
    const id = mirrorId(ownerId, calendarId, item.id);
    if (item.status === "cancelled") return (await this.repository.deleteMirror(ownerId, id)) ? "deleted" : "skipped";
    const existing = await this.repository.findById(ownerId, id);
    if (existing?.external?.etag && existing.external.etag === item.etag) return "skipped";
    const mirror = toMirrorEvent(item, { ownerId, calendarId, calendarTimeZone, syncedAt: this.now().toISOString(), existing });
    if (!mirror) return "skipped";
    await this.repository.upsertMirror(mirror);
    return "upserted";
  }

  /** Mantém o ETag da reflexão atualizado quando a própria cópia volta pela sincronização. */
  private async refreshOwnEtag(ownerId: string, item: GoogleEvent): Promise<"skipped"> {
    const localId = item.extendedProperties?.private?.[OWN_EVENT_PROPERTY];
    const event = localId ? await this.repository.findById(ownerId, localId) : null;
    if (event?.reflection && item.etag && event.reflection.etag !== item.etag && item.status !== "cancelled") {
      // Só o ETag muda; versão e updatedAt do evento não, para não conflitar com a edição do usuário.
      await this.repository.update(new CalendarEvent(event.id, event.ownerId, event.title, event.description, event.location, event.allDay, event.start, event.end, event.timeZone, event.links, event.source, event.external, { ...event.reflection, etag: item.etag }, event.createdAt, event.updatedAt, event.version), event.version);
    }
    return "skipped";
  }

  /**
   * Traduz falhas do provedor em erros públicos. Registra no cadastro só o código (sem texto do Google): sempre que o
   * acesso é recusado (`needs_reauth`) e, na sincronização (`recordError`), qualquer falha, para o usuário vê-la no status.
   */
  private async failed(ownerId: string, connection: GoogleConnection, error: unknown, recordError = true): Promise<unknown> {
    const translated = this.translate(error);
    if (translated instanceof AppError) {
      const needsReauth = translated.code === "REAUTH_REQUIRED";
      if (needsReauth || recordError) await this.repository.saveConnection(ownerId, { ...connection, status: needsReauth ? "needs_reauth" : connection.status, lastError: translated.code });
    }
    return translated;
  }

  private translate(error: unknown): unknown {
    if (!(error instanceof GoogleApiError)) return error;
    switch (error.kind) {
      case "unauthorized": return reauth();
      case "rate_limited": return new AppError(429, "RATE_LIMITED", "O Google limitou as requisições. Tente de novo em instantes.");
      case "precondition_failed": return googleConflict();
      case "not_found": return new AppError(409, "GOOGLE_EVENT_MISSING", "O evento não existe mais no Google. Desfaça o envio e envie de novo.");
      case "conflict": return googleConflict();
      case "unavailable": return new AppError(502, "UPSTREAM_UNAVAILABLE", "O Google Calendar está indisponível. Tente de novo.");
      default: return new AppError(502, "UPSTREAM_REJECTED", "O Google recusou o pedido.");
    }
  }
}

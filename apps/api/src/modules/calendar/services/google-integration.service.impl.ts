import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { normalizeTimes } from "../domain/event-time.js";
import { CalendarEvent } from "../domain/calendar-event.js";
import type { GoogleConnection, GoogleMode } from "../domain/google-connection.js";
import type { AuthorizeGoogleInput, ConnectGoogleInput, UpdateEventInput } from "../dto/input.js";
import type { GoogleStatusOutput, GoogleSyncOutput } from "../dto/output.js";
import { GoogleApiError, type GoogleCalendarClient, type GoogleEvent } from "../google/google-calendar.client.js";
import { OWN_EVENT_PROPERTY, eventIdFromGoogle, googleIdFor, mirrorId, sameRemoteContent, toGoogleBody, toMirrorEvent } from "../google/google-mapping.js";
import { SCOPE_MIRROR, SCOPE_REFLECT, type CredentialStore, type GoogleOAuth } from "../google/google-oauth.js";
import { CalendarRepository } from "../repository/calendar.repository.js";
import { GoogleIntegrationService } from "./google-integration.service.js";

export type GoogleIntegrationDeps = { oauth: GoogleOAuth; credentials: CredentialStore; client: GoogleCalendarClient };

const CALENDAR_ID = "primary";
const AUTHORIZATION_TTL_MS = 10 * 60_000;
/** Teto de páginas por sincronização: acima disso o cursor não é gravado e o usuário vê o erro, em vez de um espelho parcial "em dia". */
const MAX_PAGES = 40;

const notConfigured = () => new AppError(409, "INTEGRATION_NOT_CONFIGURED", "A integração com o Google Calendar não está configurada neste servidor.");
const notConnected = () => new AppError(409, "INTEGRATION_NOT_CONNECTED", "Conecte o Google Calendar antes de continuar.");
const reauth = () => new AppError(409, "REAUTH_REQUIRED", "O Google recusou o acesso. Conecte o Google Calendar de novo.");
const googleConflict = () => new AppError(409, "GOOGLE_CONFLICT", "O evento mudou no Google depois do último envio. Nada foi sobrescrito.");
const versionConflict = () => new AppError(409, "CONFLICT", "O evento foi alterado por outra operação. Recarregue e tente de novo.");

/** 404/410: o evento já não existe no Google. */
const missing = (error: unknown) => error instanceof GoogleApiError && (error.kind === "not_found" || error.kind === "gone");

const scopesFor = (mode: GoogleMode) => (mode === "reflect" ? [SCOPE_REFLECT] : [SCOPE_MIRROR]);
const sameSecret = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export class GoogleIntegrationServiceImpl extends GoogleIntegrationService {
  private readonly authorizationRuns = new Map<string, Promise<unknown>>();

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

  connect(ownerId: string, input: ConnectGoogleInput): Promise<GoogleStatusOutput> {
    return this.serializeAuthorization(ownerId, () => this.connectGrant(ownerId, input));
  }

  private async connectGrant(ownerId: string, input: ConnectGoogleInput): Promise<GoogleStatusOutput> {
    const google = this.require();
    const pending = await this.repository.takePending(ownerId);
    // Uso único: some antes da troca, então um `code` repetido não passa duas vezes.
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
      connectionId: randomUUID(), status: "connected", mode: pending.mode, scopes: grant.scopes, calendarId: CALENDAR_ID,
      connectedAt: this.now().toISOString(), syncToken: null, lastSyncAt: null, lastError: null,
    });
    return this.status(ownerId);
  }

  disconnect(ownerId: string): Promise<GoogleStatusOutput> {
    return this.serializeAuthorization(ownerId, () => this.disconnectGrant(ownerId));
  }

  private async disconnectGrant(ownerId: string): Promise<GoogleStatusOutput> {
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

  /** A composição local tem um processo: desconectar aguarda a troca em voo e remove também o grant recém-chegado. */
  private async serializeAuthorization<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.authorizationRuns.get(ownerId);
    const current = (previous ?? Promise.resolve()).catch(() => undefined).then(run);
    this.authorizationRuns.set(ownerId, current);
    try { return await current; }
    finally { if (this.authorizationRuns.get(ownerId) === current) this.authorizationRuns.delete(ownerId); }
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
        await this.repository.deleteAllMirrors(ownerId, connection.connectionId);
        resynced = true;
        result = await this.pull(google, ownerId, connection, null);
      }
      const lastSyncAt = this.now().toISOString();
      // Só grava se esta conexão ainda é a atual: uma sincronização em voo não ressuscita uma sessão desconectada.
      if (!(await this.repository.saveConnectionIf(ownerId, connection.connectionId, { ...connection, syncToken: result.syncToken, lastSyncAt, lastError: null }))) throw await this.dropped(ownerId, connection);
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
    // Cópia já excluída no Google: o local fica como está; reenviar exigiria desvincular antes.
    if (event.reflection?.state === "deleted_remote") return event;
    const body = toGoogleBody(event);
    const googleId = googleIdFor(event.id);
    try {
      const remote = event.reflection ? await this.update(google, ownerId, event, body) : await this.insert(google, ownerId, googleId, body);
      const saved = await this.repository.update(this.withReflection(event, { googleEventId: googleId, calendarId: CALENDAR_ID, etag: remote.etag ?? "", reflectedVersion: event.version + 1, reflectedAt: this.now().toISOString(), state: "linked" }), event.version);
      // O Google já tem o evento; o próximo envio reconcilia pelo conteúdo, então perder esta corrida não duplica nada.
      if (!saved) throw versionConflict();
      return saved;
    } catch (error) {
      // Atualizar uma cópia que sumiu do Google não é conflito: registra o estado e mantém a gravação local.
      if (event.reflection && missing(error)) {
        const marked = await this.markRemoteDeleted(event);
        if (!marked) throw versionConflict();
        return marked;
      }
      throw await this.failed(ownerId, connection, error, false);
    }
  }

  async unreflect(ownerId: string, eventId: string, options: { keepRemote: boolean }): Promise<CalendarEvent> {
    const event = await this.local(ownerId, eventId);
    if (!event.reflection) return event;
    if (!options.keepRemote && event.reflection.state !== "deleted_remote") {
      const google = this.require();
      const connection = await this.connected(ownerId);
      try { await this.deleteRemote(google, ownerId, event.reflection.calendarId, event.reflection.googleEventId, event.reflection.etag); }
      catch (error) { throw await this.failed(ownerId, connection, error, false); }
    }
    const next = this.withReflection(event, null);
    const saved = await this.repository.update(next, event.version);
    if (!saved) throw versionConflict();
    return saved;
  }

  /** Mantém o vínculo até excluir o registro: uma edição concorrente preserva a referência para retry. */
  async deleteReflected(ownerId: string, id: string, version: number): Promise<void> {
    const google = this.require();
    const event = await this.local(ownerId, id);
    if (event.version !== version || !event.reflection) throw versionConflict();
    // Já excluído no Google: não há o que apagar lá, nem exigência de conexão.
    if (event.reflection.state === "deleted_remote") {
      if (await this.repository.delete(ownerId, id, version) === "conflict") throw versionConflict();
      return;
    }
    const connection = await this.connected(ownerId);
    try {
      await this.deleteRemote(google, ownerId, event.reflection.calendarId, event.reflection.googleEventId, event.reflection.etag);
      await this.assertCurrent(ownerId, connection);
      if (await this.repository.delete(ownerId, id, version) === "conflict") throw versionConflict();
    } catch (error) { throw await this.failed(ownerId, connection, error, false); }
  }

  /** Escrita explícita de um espelho: usa o ETag que foi lido, preservando campos remotos fora do formulário. */
  async updateMirror(ownerId: string, id: string, input: UpdateEventInput): Promise<CalendarEvent> {
    const google = this.require();
    const connection = await this.writable(ownerId);
    const event = await this.mirror(ownerId, id, input.version, connection);
    if (input.links?.length) throw new AppError(400, "VALIDATION_ERROR", "Relações não são suportadas em eventos do Google.");
    const times = normalizeTimes({ allDay: input.allDay ?? event.allDay, start: input.start ?? event.start, end: input.end ?? event.end, timeZone: input.timeZone === undefined ? event.timeZone : input.timeZone });
    const candidate = new CalendarEvent(id, ownerId, input.title ?? event.title, input.description ?? event.description, input.location ?? event.location, times.allDay, times.start, times.end, times.timeZone, [], "google", event.external, null, event.createdAt, this.now().toISOString(), event.version + 1);
    const mapped = toGoogleBody(candidate);
    // O espelho limita textos para exibição. Reenviar campos inalterados truncaria o original remoto.
    const body = {
      ...(candidate.title !== event.title ? { summary: mapped.summary } : {}),
      ...(candidate.description !== event.description ? { description: mapped.description } : {}),
      ...(candidate.location !== event.location ? { location: mapped.location } : {}),
      ...(candidate.allDay !== event.allDay || candidate.start !== event.start || candidate.end !== event.end || candidate.timeZone !== event.timeZone
        ? { start: mapped.start, end: mapped.end } : {}),
    };
    try {
      let remote: GoogleEvent;
      try { remote = await google.client.updateEvent(ownerId, connection.calendarId, event.external!.externalId, body, event.external!.etag); }
      catch (error) {
        if (missing(error)) {
          // Excluído no Google: o espelho não tem mais origem. Remove-o em vez de deixar um conflito sem saída.
          await this.repository.deleteMirror(ownerId, id);
          throw new AppError(404, "NOT_FOUND", "O evento foi excluído no Google.");
        }
        if (!(error instanceof GoogleApiError) || error.kind !== "precondition_failed") throw error;
        remote = await google.client.getEvent(ownerId, connection.calendarId, event.external!.externalId);
        if (!sameRemoteContent(remote, { ...remote, ...body })) throw error;
      }
      await this.assertCurrent(ownerId, connection);
      const saved = toMirrorEvent(remote, { ownerId, calendarId: connection.calendarId, connectionId: connection.connectionId, calendarTimeZone: candidate.timeZone ?? undefined, syncedAt: this.now().toISOString(), existing: event });
      if (!saved) throw new GoogleApiError("invalid");
      const result = await this.repository.update(saved, event.version);
      if (!result) throw versionConflict();
      return result;
    } catch (error) { throw await this.failed(ownerId, connection, error, false); }
  }

  async deleteMirror(ownerId: string, id: string, version: number): Promise<void> {
    const google = this.require();
    const connection = await this.writable(ownerId);
    const event = await this.mirror(ownerId, id, version, connection);
    try {
      await this.deleteRemote(google, ownerId, connection.calendarId, event.external!.externalId, event.external!.etag);
      await this.assertCurrent(ownerId, connection);
      const result = await this.repository.delete(ownerId, id, version);
      if (result === "conflict") throw versionConflict();
    } catch (error) { throw await this.failed(ownerId, connection, error, false); }
  }

  private async writable(ownerId: string) {
    const connection = await this.repository.getConnection(ownerId);
    if (!connection || connection.mode !== "reflect") throw new AppError(409, "READ_ONLY_EVENT", "Conecte com permissão de escrita para alterar eventos do Google.");
    if (connection.status === "needs_reauth") throw reauth();
    return connection;
  }

  private async mirror(ownerId: string, id: string, version: number, connection: GoogleConnection) {
    const event = await this.repository.findById(ownerId, id);
    if (!event) throw new AppError(404, "NOT_FOUND", "Evento não encontrado.");
    if (event.source !== "google" || !event.external || event.external.connectionId !== connection.connectionId) throw versionConflict();
    if (event.version !== version) throw versionConflict();
    if (!event.external.etag) throw googleConflict();
    return event;
  }

  /** A conexão desta operação foi desconectada ou refeita no meio: remove o que ela gravou e informa. */
  private async dropped(ownerId: string, connection: GoogleConnection): Promise<AppError> {
    await this.repository.deleteAllMirrors(ownerId, connection.connectionId);
    return notConnected();
  }

  private async assertCurrent(ownerId: string, connection: GoogleConnection): Promise<void> {
    if ((await this.repository.getConnection(ownerId))?.connectionId !== connection.connectionId) throw await this.dropped(ownerId, connection);
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

  /** Apaga no Google; evento já ausente (404/410, ou 412 com a cópia remota cancelada/ausente) conta como removido. */
  private async deleteRemote(google: GoogleIntegrationDeps, ownerId: string, calendarId: string, eventId: string, etag: string): Promise<void> {
    try { await google.client.deleteEvent(ownerId, calendarId, eventId, etag); }
    catch (error) {
      if (missing(error)) return;
      if (!(error instanceof GoogleApiError && error.kind === "precondition_failed")) throw error;
      // 412 com ETag velho só é conflito se o evento ainda existe no Google.
      let remote: GoogleEvent;
      try { remote = await google.client.getEvent(ownerId, calendarId, eventId); }
      catch (lookup) { if (missing(lookup)) return; throw lookup; }
      if (remote.status !== "cancelled") throw error;
    }
  }

  /** Mantém versão e `updatedAt`, como `refreshOwnEtag`: o aviso do Google não pode conflitar com a edição do usuário. */
  private markRemoteDeleted(event: CalendarEvent): Promise<CalendarEvent | null> {
    const next = new CalendarEvent(event.id, event.ownerId, event.title, event.description, event.location, event.allDay, event.start, event.end, event.timeZone, event.links, event.source, event.external, { ...event.reflection!, state: "deleted_remote" }, event.createdAt, event.updatedAt, event.version);
    return this.repository.update(next, event.version);
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
      // Conteúdo diferente: pode ser edição feita no Google. Conflito explícito, nunca sobrescrita com o ETag recém-lido.
      throw new GoogleApiError("precondition_failed");
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

    const timeMin = syncToken ? undefined : new Date(this.now().getTime() - 30 * 86_400_000).toISOString();
    const timeMax = syncToken ? undefined : new Date(this.now().getTime() + 366 * 86_400_000).toISOString();
    let pageToken: string | undefined;
    let pages = 0, upserted = 0, deleted = 0;
    for (;;) {
      if (pages >= MAX_PAGES) throw new AppError(502, "SYNC_TOO_LARGE", "A sincronização excedeu o limite de páginas. Nada foi marcado como em dia.");
      const page = await google.client.listEvents(ownerId, connection.calendarId, { syncToken: syncToken ?? undefined, pageToken, timeMin, timeMax });
      pages++;
      // Desconectar no meio da sincronização: nada desta página é gravado.
      await this.assertCurrent(ownerId, connection);
      for (const item of page.items) {
        const outcome = await this.apply(ownerId, connection, page.timeZone, item);
        if (outcome === "upserted") upserted++; else if (outcome === "deleted") deleted++;
      }
      if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
      // O token novo só vem na última página; sem ele não dá para afirmar que o espelho está completo.
      if (!page.nextSyncToken) throw new AppError(502, "SYNC_INCOMPLETE", "O Google não devolveu o cursor de sincronização.");
      return { kind, pages, upserted, deleted, syncToken: page.nextSyncToken };
    }
  }

  private async apply(ownerId: string, connection: GoogleConnection, calendarTimeZone: string | undefined, item: GoogleEvent): Promise<"upserted" | "deleted" | "skipped"> {
    // Cópia que o app enviou e foi excluída no Google: o cancelamento só garante o `id`, então acha o local pelo ID derivado.
    if (item.status === "cancelled" && await this.flagDeletedCopy(ownerId, item.id)) return "deleted";
    // Cópia que o próprio app enviou: o original local é a fonte, não se reimporta como espelho.
    if (item.extendedProperties?.private?.[OWN_EVENT_PROPERTY]) return this.refreshOwnEtag(ownerId, item);
    const calendarId = connection.calendarId;
    const id = mirrorId(ownerId, calendarId, item.id);
    if (item.status === "cancelled") return (await this.repository.deleteMirror(ownerId, id)) ? "deleted" : "skipped";
    const existing = await this.repository.findById(ownerId, id);
    if (existing?.external?.connectionId === connection.connectionId && existing.external.etag && existing.external.etag === item.etag) return "skipped";
    const mirror = toMirrorEvent(item, { ownerId, calendarId, connectionId: connection.connectionId, calendarTimeZone, syncedAt: this.now().toISOString(), existing });
    if (!mirror) return "skipped";
    await this.repository.upsertMirror(mirror);
    return "upserted";
  }

  private async flagDeletedCopy(ownerId: string, googleId: string): Promise<boolean> {
    const localId = eventIdFromGoogle(googleId);
    const event = localId ? await this.repository.findById(ownerId, localId) : null;
    if (event?.source !== "local" || event.reflection?.googleEventId !== googleId || event.reflection.state === "deleted_remote") return false;
    // Se uma edição concorrente venceu, a próxima sincronização ou o próximo envio ao Google marca o estado.
    return (await this.markRemoteDeleted(event)) !== null;
  }

  /**
   * Quando a própria cópia volta pela sincronização, só adota o ETag novo se o conteúdo remoto for exatamente o que o
   * app enviaria. ETag com conteúdo diferente é edição feita no Google: não avança, e o próximo envio responde 412
   * (`GOOGLE_CONFLICT`) em vez de sobrescrevê-la. Só o ETag muda; versão e `updatedAt` não, para não conflitar com o usuário.
   */
  private async refreshOwnEtag(ownerId: string, item: GoogleEvent): Promise<"skipped"> {
    const localId = item.extendedProperties?.private?.[OWN_EVENT_PROPERTY];
    const event = localId ? await this.repository.findById(ownerId, localId) : null;
    if (event?.reflection && item.etag && event.reflection.etag !== item.etag && item.status !== "cancelled" && sameRemoteContent(item, toGoogleBody(event))) {
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
      // Condicionado à conexão: um erro tardio não ressuscita nem altera uma sessão desconectada/refeita.
      if (needsReauth || recordError) await this.repository.saveConnectionIf(ownerId, connection.connectionId, { ...connection, status: needsReauth ? "needs_reauth" : connection.status, lastError: translated.code });
    }
    return translated;
  }

  private translate(error: unknown): unknown {
    if (!(error instanceof GoogleApiError)) return error;
    switch (error.kind) {
      case "unauthorized": return reauth();
      case "rate_limited": return new AppError(429, "RATE_LIMITED", "O Google limitou as requisições. Tente de novo em instantes.", error.retryAfterMs);
      case "precondition_failed": return googleConflict();
      case "not_found": return new AppError(409, "GOOGLE_EVENT_MISSING", "O evento não existe mais no Google. Desfaça o envio e envie de novo.");
      case "conflict": return googleConflict();
      case "unavailable": return new AppError(502, "UPSTREAM_UNAVAILABLE", "O Google Calendar está indisponível. Tente de novo.", error.retryAfterMs);
      default: return new AppError(502, "UPSTREAM_REJECTED", "O Google recusou o pedido.");
    }
  }
}

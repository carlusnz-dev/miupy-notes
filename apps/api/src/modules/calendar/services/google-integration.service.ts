import { BaseService } from "../../../core/services/base.service.js";
import type { CalendarEvent } from "../domain/calendar-event.js";
import type { AuthorizeGoogleInput, ConnectGoogleInput } from "../dto/input.js";
import type { GoogleAuthorizationOutput, GoogleStatusOutput, GoogleSyncOutput } from "../dto/output.js";
import { CalendarRepository } from "../repository/calendar.repository.js";

export abstract class GoogleIntegrationService extends BaseService<CalendarEvent, CalendarRepository> {
  abstract status(ownerId: string): Promise<GoogleStatusOutput>;
  abstract authorize(ownerId: string, input: AuthorizeGoogleInput): Promise<GoogleAuthorizationOutput>;
  abstract connect(ownerId: string, input: ConnectGoogleInput): Promise<GoogleStatusOutput>;
  abstract disconnect(ownerId: string): Promise<GoogleStatusOutput>;
  /** Espelho (leitura): traz as mudanças do Google para o app. */
  abstract sync(ownerId: string): Promise<GoogleSyncOutput>;
  /** Refletor (escrita consentida): envia/atualiza este evento local no Google. */
  abstract reflect(ownerId: string, eventId: string): Promise<CalendarEvent>;
  /** Remove o envio; `keepRemote` só desfaz o vínculo local e não toca no Google. */
  abstract unreflect(ownerId: string, eventId: string, options: { keepRemote: boolean }): Promise<CalendarEvent>;
}

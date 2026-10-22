import { BaseService } from "../../../core/services/base.service.js";
import type { CalendarEvent } from "../domain/calendar-event.js";
import type { UpdateEventInput } from "../dto/input.js";
import type { GoogleStatusOutput, GoogleSyncOutput } from "../dto/output.js";
import { CalendarRepository } from "../repository/calendar.repository.js";

export abstract class GoogleIntegrationService extends BaseService<CalendarEvent, CalendarRepository> {
  abstract updateMirror(ownerId: string, id: string, input: UpdateEventInput): Promise<CalendarEvent>;
  abstract deleteReflected(ownerId: string, id: string, version: number): Promise<void>;
  abstract deleteMirror(ownerId: string, id: string, version: number): Promise<void>;
  abstract status(ownerId: string): Promise<GoogleStatusOutput>;
  /** Ativa o Calendar com os escopos que o login já concedeu; não abre consentimento. */
  abstract connect(ownerId: string): Promise<GoogleStatusOutput>;
  /** Para de usar o Calendar neste app e apaga os espelhos; não revoga o token do login. */
  abstract disconnect(ownerId: string): Promise<GoogleStatusOutput>;
  /** Espelho (leitura): traz as mudanças do Google para o app. */
  abstract sync(ownerId: string): Promise<GoogleSyncOutput>;
  /** Refletor (escrita consentida): envia/atualiza este evento local no Google. */
  abstract reflect(ownerId: string, eventId: string): Promise<CalendarEvent>;
  /** Remove o envio; `keepRemote` só desfaz o vínculo local e não toca no Google. */
  abstract unreflect(ownerId: string, eventId: string, options: { keepRemote: boolean }): Promise<CalendarEvent>;
}

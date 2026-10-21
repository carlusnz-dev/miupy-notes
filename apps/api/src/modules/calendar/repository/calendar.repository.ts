import { BaseRepository } from "../../../core/repository/base.repository.js";
import type { CalendarEvent } from "../domain/calendar-event.js";
import type { GoogleConnection, PendingAuthorization } from "../domain/google-connection.js";

export type EventPage = { readonly items: CalendarEvent[]; readonly nextCursor: string | null };
/** `from`/`to` são instantes UTC normalizados; o filtro é a sobreposição `startsAt < to && endsAt > from`. */
export type EventQuery = { readonly limit: number; readonly cursor?: string; readonly from?: string; readonly to?: string };
export type DeleteResult = "deleted" | "missing" | "conflict";

export abstract class CalendarRepository extends BaseRepository<CalendarEvent> {
  /** Falha com `409 CONFLICT` se o ID já existe para o proprietário. */
  abstract create(event: CalendarEvent): Promise<CalendarEvent>;
  abstract list(ownerId: string, query: EventQuery): Promise<EventPage>;
  /** Grava somente se a versão persistida ainda for `expectedVersion`; `null` em conflito ou ausência. */
  abstract update(event: CalendarEvent, expectedVersion: number): Promise<CalendarEvent | null>;
  abstract delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult>;
  /** Espelho do Google: grava sem condição de versão, mas nunca sobre um evento local. */
  abstract upsertMirror(event: CalendarEvent): Promise<void>;
  abstract deleteMirror(ownerId: string, id: string): Promise<boolean>;
  /** Remove espelhos do proprietário; com `connectionId`, só os gravados por essa conexão. */
  abstract deleteAllMirrors(ownerId: string, connectionId?: string): Promise<number>;

  abstract getConnection(ownerId: string): Promise<GoogleConnection | null>;
  abstract saveConnection(ownerId: string, connection: GoogleConnection): Promise<void>;
  /** Grava somente se a conexão persistida ainda tem este `connectionId`; `false` = foi desconectada/refeita. */
  abstract saveConnectionIf(ownerId: string, connectionId: string, connection: GoogleConnection): Promise<boolean>;
  abstract deleteConnection(ownerId: string): Promise<void>;
  abstract getPending(ownerId: string): Promise<PendingAuthorization | null>;
  abstract savePending(ownerId: string, pending: PendingAuthorization): Promise<void>;
  abstract clearPending(ownerId: string): Promise<void>;
}

import { BaseService } from "../../../core/services/base.service.js";
import type { CalendarEvent } from "../domain/calendar-event.js";
import type { CreateEventInput, ListEventsQuery, UpdateEventInput } from "../dto/input.js";
import { CalendarRepository, type EventPage } from "../repository/calendar.repository.js";

export abstract class CalendarService extends BaseService<CalendarEvent, CalendarRepository> {
  /** `created: false` quando o mesmo envio (mesmo `id`, mesmo conteúdo) já tinha sido aceito. */
  abstract create(ownerId: string, input: CreateEventInput): Promise<{ event: CalendarEvent; created: boolean }>;
  abstract findById(ownerId: string, id: string): Promise<CalendarEvent>;
  abstract list(ownerId: string, query: ListEventsQuery): Promise<EventPage>;
  abstract update(ownerId: string, id: string, input: UpdateEventInput): Promise<CalendarEvent>;
  abstract delete(ownerId: string, id: string, version: number): Promise<void>;
}

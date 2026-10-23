import type { CalendarEvent } from "../domain/calendar-event.js";
import type { EventPage } from "../repository/calendar.repository.js";
import { calendarEventListOutputSchema, calendarEventOutputSchema, type CalendarEventListOutput, type CalendarEventOutput } from "./output.js";

export class CalendarDtoAdapter {
  static toOutput(event: CalendarEvent): CalendarEventOutput {
    return calendarEventOutputSchema.parse({
      id: event.id, title: event.title, description: event.description, location: event.location,
      allDay: event.allDay, start: event.start, end: event.end, timeZone: event.timeZone,
      links: event.links, source: event.source, readOnly: event.source !== "local",
      // `etag` e IDs do Google ficam no servidor.
      external: event.external && { provider: event.external.provider, calendarId: event.external.calendarId, syncedAt: event.external.syncedAt },
      reflection: event.reflection && { reflectedAt: event.reflection.reflectedAt, reflectedVersion: event.reflection.reflectedVersion, inSync: event.reflection.state === "linked" && event.reflection.reflectedVersion === event.version, state: event.reflection.state },
      createdAt: event.createdAt, updatedAt: event.updatedAt, version: event.version,
    });
  }

  static toListOutput(page: EventPage): CalendarEventListOutput {
    return calendarEventListOutputSchema.parse({ items: page.items.map(CalendarDtoAdapter.toOutput), nextCursor: page.nextCursor });
  }
}

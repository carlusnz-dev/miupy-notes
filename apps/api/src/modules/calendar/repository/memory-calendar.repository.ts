import { AppError } from "../../../core/domain/app-error.js";
import type { CalendarEvent } from "../domain/calendar-event.js";
import { overlaps } from "../domain/event-time.js";
import type { GoogleConnection } from "../domain/google-connection.js";
import { CalendarRepository, type DeleteResult, type EventPage, type EventQuery } from "./calendar.repository.js";

/** Implementação em memória para testes; ordena por ID como a chave de ordenação do DynamoDB. */
export class MemoryCalendarRepository extends CalendarRepository {
  private readonly events = new Map<string, CalendarEvent>();
  private readonly connections = new Map<string, GoogleConnection>();

  async create(event: CalendarEvent): Promise<CalendarEvent> {
    const key = `${event.ownerId}:${event.id}`;
    if (this.events.has(key)) throw new AppError(409, "CONFLICT", "Já existe um evento com este identificador.");
    this.events.set(key, event);
    return event;
  }

  async findById(ownerId: string, id: string): Promise<CalendarEvent | null> {
    return this.events.get(`${ownerId}:${id}`) ?? null;
  }

  async list(ownerId: string, query: EventQuery): Promise<EventPage> {
    const after = query.cursor ? Buffer.from(query.cursor, "base64url").toString("utf8") : "";
    const matching = [...this.events.values()]
      .filter((event) => event.ownerId === ownerId && event.id > after && overlaps(event, query.from, query.to))
      .sort((a, b) => a.id.localeCompare(b.id));
    const items = matching.slice(0, query.limit);
    return { items, nextCursor: matching.length > query.limit ? Buffer.from(items.at(-1)!.id).toString("base64url") : null };
  }

  async update(event: CalendarEvent, expectedVersion: number): Promise<CalendarEvent | null> {
    const key = `${event.ownerId}:${event.id}`;
    if (this.events.get(key)?.version !== expectedVersion) return null;
    this.events.set(key, event);
    return event;
  }

  async delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult> {
    const current = this.events.get(`${ownerId}:${id}`);
    if (!current) return "missing";
    if (current.version !== expectedVersion) return "conflict";
    this.events.delete(`${ownerId}:${id}`);
    return "deleted";
  }

  async upsertMirror(event: CalendarEvent): Promise<void> {
    const key = `${event.ownerId}:${event.id}`;
    if (this.events.get(key)?.source === "local") throw new AppError(409, "CONFLICT", "Identificador ocupado por evento local.");
    this.events.set(key, event);
  }

  async deleteMirror(ownerId: string, id: string): Promise<boolean> {
    const key = `${ownerId}:${id}`;
    if (this.events.get(key)?.source !== "google") return false;
    return this.events.delete(key);
  }

  async deleteAllMirrors(ownerId: string, connectionId?: string): Promise<number> {
    let removed = 0;
    for (const [key, event] of this.events) {
      if (event.ownerId === ownerId && event.source === "google" && (connectionId === undefined || event.external?.connectionId === connectionId)) { this.events.delete(key); removed++; }
    }
    return removed;
  }

  async getConnection(ownerId: string) { return this.connections.get(ownerId) ?? null; }
  async saveConnection(ownerId: string, connection: GoogleConnection) { this.connections.set(ownerId, connection); }
  async saveConnectionIf(ownerId: string, connectionId: string, connection: GoogleConnection) {
    if (this.connections.get(ownerId)?.connectionId !== connectionId) return false;
    this.connections.set(ownerId, connection);
    return true;
  }
  async deleteConnection(ownerId: string) { this.connections.delete(ownerId); }
}

import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { CalendarEvent, type EventLink } from "../domain/calendar-event.js";
import { normalizeTimes } from "../domain/event-time.js";
import type { CreateEventInput, ListEventsQuery, UpdateEventInput } from "../dto/input.js";
import { CalendarRepository, type EventPage } from "../repository/calendar.repository.js";
import { CalendarService } from "./calendar.service.js";
import type { NoteDirectory } from "./note-directory.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Evento não encontrado.");
const conflict = () => new AppError(409, "CONFLICT", "O evento foi alterado por outra operação. Recarregue e tente de novo.");
const readOnly = () => new AppError(409, "READ_ONLY_EVENT", "Eventos espelhados do Google são somente leitura.");

const sorted = (links: readonly EventLink[]) => [...links].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
/** Mesmo conteúdo editável (ignora datas de gravação e versão): base da idempotência do POST. */
function sameContent(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.source === "local" && a.title === b.title && a.description === b.description && a.location === b.location && a.allDay === b.allDay
    && a.start === b.start && a.end === b.end && a.timeZone === b.timeZone && JSON.stringify(sorted(a.links)) === JSON.stringify(sorted(b.links));
}

export class CalendarServiceImpl extends CalendarService {
  constructor(repository: CalendarRepository, private readonly notes: NoteDirectory) { super(repository); }

  async create(ownerId: string, input: CreateEventInput) {
    const times = normalizeTimes(input);
    const id = input.id ?? randomUUID();
    const links = await this.validLinks(ownerId, id, input.links);
    const now = new Date().toISOString();
    const candidate = new CalendarEvent(id, ownerId, input.title, input.description, input.location, times.allDay, times.start, times.end, times.timeZone, links, "local", null, null, now, now, 1);
    if (input.id) {
      const existing = await this.repository.findById(ownerId, id);
      if (existing) {
        if (sameContent(existing, candidate)) return { event: existing, created: false };
        throw new AppError(409, "CONFLICT", "Já existe um evento com este identificador e conteúdo diferente.");
      }
    }
    return { event: await this.repository.create(candidate), created: true };
  }

  async findById(ownerId: string, id: string): Promise<CalendarEvent> {
    const event = await this.repository.findById(ownerId, id);
    if (!event) throw notFound();
    return event;
  }

  list(ownerId: string, query: ListEventsQuery): Promise<EventPage> {
    // Instantes equivalentes com deslocamentos diferentes precisam da mesma forma para a comparação de texto.
    const instant = (value?: string) => (value === undefined ? undefined : new Date(value).toISOString());
    const from = instant(query.from), to = instant(query.to);
    if (from !== undefined && to !== undefined && to <= from) throw new AppError(400, "VALIDATION_ERROR", "O fim do período deve ser posterior ao início.");
    return this.repository.list(ownerId, { limit: query.limit, cursor: query.cursor, from, to });
  }

  async update(ownerId: string, id: string, input: UpdateEventInput): Promise<CalendarEvent> {
    const current = await this.findById(ownerId, id);
    if (current.source !== "local") throw readOnly();
    if (current.version !== input.version) throw conflict();
    const timeTouched = input.allDay !== undefined || input.start !== undefined || input.end !== undefined || input.timeZone !== undefined;
    const times = timeTouched
      ? normalizeTimes({ allDay: input.allDay ?? current.allDay, start: input.start ?? current.start, end: input.end ?? current.end, timeZone: input.timeZone !== undefined ? input.timeZone : current.timeZone })
      : { allDay: current.allDay, start: current.start, end: current.end, timeZone: current.timeZone };
    const links = input.links === undefined ? current.links : await this.validLinks(ownerId, id, input.links);
    const next = new CalendarEvent(
      id, ownerId, input.title ?? current.title, input.description ?? current.description, input.location ?? current.location,
      times.allDay, times.start, times.end, times.timeZone, links, "local", null, current.reflection, current.createdAt, new Date().toISOString(), current.version + 1,
    );
    // A condição no repositório cobre gravações concorrentes entre a leitura e a escrita.
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return saved;
  }

  async delete(ownerId: string, id: string, version: number): Promise<void> {
    const current = await this.findById(ownerId, id);
    if (current.source !== "local") throw readOnly();
    if (current.reflection) throw new AppError(409, "REFLECTION_ACTIVE", "Remova o envio ao Google antes de excluir o evento.");
    const result = await this.repository.delete(ownerId, id, version);
    if (result === "missing") throw notFound();
    if (result === "conflict") throw conflict();
  }

  /** Relação inválida (item ausente, de outro proprietário ou o próprio evento) responde igual, sem revelar o motivo. */
  private async validLinks(ownerId: string, selfId: string, links: readonly EventLink[]): Promise<EventLink[]> {
    const unique = [...new Map(links.map((link) => [`${link.kind}:${link.id}`, link])).values()];
    for (const link of unique) {
      const ok = link.kind === "note"
        ? await this.notes.exists(ownerId, link.id)
        : link.id !== selfId && (await this.repository.findById(ownerId, link.id)) !== null;
      if (!ok) throw new AppError(400, "VALIDATION_ERROR", "Relação inválida.");
    }
    return unique;
  }
}

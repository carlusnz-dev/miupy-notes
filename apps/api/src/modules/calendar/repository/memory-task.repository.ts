import { AppError } from "../../../core/domain/app-error.js";
import type { CalendarTask } from "../domain/calendar-task.js";
import type { DeleteResult } from "./calendar.repository.js";
import { TaskRepository, type TaskPage, type TaskQuery } from "./task.repository.js";

/** Implementação em memória para testes; ordena por ID como a chave de ordenação do DynamoDB. */
export class MemoryTaskRepository extends TaskRepository {
  private readonly tasks = new Map<string, CalendarTask>();

  async create(task: CalendarTask): Promise<CalendarTask> {
    const key = `${task.ownerId}:${task.id}`;
    if (this.tasks.has(key)) throw new AppError(409, "CONFLICT", "Já existe uma tarefa com este identificador.");
    this.tasks.set(key, task);
    return task;
  }

  async findById(ownerId: string, id: string): Promise<CalendarTask | null> { return this.tasks.get(`${ownerId}:${id}`) ?? null; }

  async list(ownerId: string, query: TaskQuery): Promise<TaskPage> {
    const after = query.cursor ? Buffer.from(query.cursor, "base64url").toString("utf8") : "";
    const matching = [...this.tasks.values()]
      .filter((task) => task.ownerId === ownerId && task.id > after && (query.status === undefined || task.status === query.status))
      .sort((a, b) => a.id.localeCompare(b.id));
    const items = matching.slice(0, query.limit);
    return { items, nextCursor: matching.length > query.limit ? Buffer.from(items.at(-1)!.id).toString("base64url") : null };
  }

  async update(task: CalendarTask, expectedVersion: number): Promise<CalendarTask | null> {
    const key = `${task.ownerId}:${task.id}`;
    if (this.tasks.get(key)?.version !== expectedVersion) return null;
    this.tasks.set(key, task);
    return task;
  }

  async delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult> {
    const current = this.tasks.get(`${ownerId}:${id}`);
    if (!current) return "missing";
    if (current.version !== expectedVersion) return "conflict";
    this.tasks.delete(`${ownerId}:${id}`);
    return "deleted";
  }
}

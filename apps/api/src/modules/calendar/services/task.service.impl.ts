import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { CalendarTask } from "../domain/calendar-task.js";
import { normalizeSchedule } from "../domain/task-time.js";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "../dto/task-input.js";
import type { TaskPage, TaskRepository } from "../repository/task.repository.js";
import type { TaskGoogleSync } from "./task-google-sync.js";
import { TaskService } from "./task.service.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Tarefa não encontrada.");
const conflict = () => new AppError(409, "CONFLICT", "A tarefa foi alterada por outra operação. Recarregue e tente de novo.");

/** Mesmo conteúdo editável (ignora datas de gravação e versão): base da idempotência do POST. */
const sameContent = (a: CalendarTask, b: CalendarTask) => a.title === b.title && a.description === b.description && a.dueDate === b.dueDate && a.dueTime === b.dueTime && a.status === b.status;

export class TaskServiceImpl extends TaskService {
  constructor(repository: TaskRepository, private readonly sync: TaskGoogleSync | null = null) { super(repository); }

  async create(ownerId: string, input: CreateTaskInput) {
    const { dueDate, dueTime } = normalizeSchedule(input);
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const candidate = new CalendarTask(id, ownerId, input.title, input.description, dueDate, dueTime, input.status, input.status === "completed" ? now : null, null, now, now, 1);
    if (input.id) {
      const existing = await this.repository.findById(ownerId, id);
      if (existing) {
        if (sameContent(existing, candidate)) return { task: existing, created: false };
        throw new AppError(409, "CONFLICT", "Já existe uma tarefa com este identificador e conteúdo diferente.");
      }
    }
    const saved = await this.repository.create(candidate);
    return { task: (await this.sync?.afterSave(saved))?.task ?? saved, created: true };
  }

  async findById(ownerId: string, id: string): Promise<CalendarTask> {
    const task = await this.repository.findById(ownerId, id);
    if (!task) throw notFound();
    return task;
  }

  list(ownerId: string, query: ListTasksQuery): Promise<TaskPage> {
    return this.repository.list(ownerId, { limit: query.limit, cursor: query.cursor, status: query.status });
  }

  async update(ownerId: string, id: string, input: UpdateTaskInput): Promise<CalendarTask> {
    const current = await this.findById(ownerId, id);
    if (current.version !== input.version) throw conflict();
    const { dueDate, dueTime } = normalizeSchedule({ dueDate: input.dueDate !== undefined ? input.dueDate : current.dueDate, dueTime: input.dueTime !== undefined ? input.dueTime : current.dueTime });
    const status = input.status ?? current.status;
    const now = new Date().toISOString();
    // Concluir grava o instante; reabrir limpa; editar outros campos de uma concluída preserva o instante original.
    const completedAt = status === "completed" ? (current.status === "completed" ? current.completedAt : now) : null;
    const next = new CalendarTask(id, ownerId, input.title ?? current.title, input.description ?? current.description, dueDate, dueTime, status, completedAt, current.external, current.createdAt, now, current.version + 1);
    // A condição no repositório cobre gravações concorrentes entre a leitura e a escrita.
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return (await this.sync?.afterSave(saved))?.task ?? saved;
  }

  async delete(ownerId: string, id: string, version: number): Promise<void> {
    const current = await this.findById(ownerId, id);
    const result = await this.repository.delete(ownerId, id, version);
    if (result === "missing") throw notFound();
    if (result === "conflict") throw conflict();
    await this.sync?.afterDelete(current);
  }
}

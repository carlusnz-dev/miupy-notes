import { BaseRepository } from "../../../core/repository/base.repository.js";
import type { CalendarTask, TaskStatus } from "../domain/calendar-task.js";
import type { DeleteResult } from "./calendar.repository.js";

export type TaskPage = { readonly items: CalendarTask[]; readonly nextCursor: string | null };
export type TaskQuery = { readonly limit: number; readonly cursor?: string; readonly status?: TaskStatus };

export abstract class TaskRepository extends BaseRepository<CalendarTask> {
  /** Falha com `409 CONFLICT` se o ID já existe para o proprietário. */
  abstract create(task: CalendarTask): Promise<CalendarTask>;
  abstract list(ownerId: string, query: TaskQuery): Promise<TaskPage>;
  /** Grava somente se a versão persistida ainda for `expectedVersion`; `null` em conflito ou ausência. */
  abstract update(task: CalendarTask, expectedVersion: number): Promise<CalendarTask | null>;
  abstract delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult>;
}

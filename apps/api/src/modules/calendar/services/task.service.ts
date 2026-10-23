import { BaseService } from "../../../core/services/base.service.js";
import type { CalendarTask } from "../domain/calendar-task.js";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "../dto/task-input.js";
import type { TaskPage, TaskRepository } from "../repository/task.repository.js";

export abstract class TaskService extends BaseService<CalendarTask, TaskRepository> {
  abstract create(ownerId: string, input: CreateTaskInput): Promise<{ task: CalendarTask; created: boolean }>;
  abstract findById(ownerId: string, id: string): Promise<CalendarTask>;
  abstract list(ownerId: string, query: ListTasksQuery): Promise<TaskPage>;
  abstract update(ownerId: string, id: string, input: UpdateTaskInput): Promise<CalendarTask>;
  abstract delete(ownerId: string, id: string, version: number): Promise<void>;
}

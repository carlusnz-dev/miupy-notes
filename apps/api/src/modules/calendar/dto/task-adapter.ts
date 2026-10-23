import type { CalendarTask } from "../domain/calendar-task.js";
import type { TaskPage } from "../repository/task.repository.js";
import { taskListOutputSchema, taskOutputSchema, type TaskListOutput, type TaskOutput } from "./task-output.js";

export class TaskDtoAdapter {
  static toOutput(task: CalendarTask): TaskOutput {
    return taskOutputSchema.parse({
      id: task.id, title: task.title, description: task.description, dueDate: task.dueDate, dueTime: task.dueTime,
      status: task.status, completedAt: task.completedAt, inGoogle: task.external !== null,
      createdAt: task.createdAt, updatedAt: task.updatedAt, version: task.version,
    });
  }

  static toListOutput(page: TaskPage): TaskListOutput {
    return taskListOutputSchema.parse({ items: page.items.map(TaskDtoAdapter.toOutput), nextCursor: page.nextCursor });
  }
}

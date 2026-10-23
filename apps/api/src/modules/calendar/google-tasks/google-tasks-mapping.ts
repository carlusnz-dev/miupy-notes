import type { CalendarTask } from "../domain/calendar-task.js";
import type { GoogleTaskBody } from "./google-tasks.client.js";

/** Tarefa local → corpo da Tasks API. "Concluída" local = `completed` no Google; pendente = `needsAction`. */
export function toGoogleTaskBody(task: CalendarTask): GoogleTaskBody {
  const done = task.status === "completed";
  return {
    title: task.title,
    notes: task.description,
    status: done ? "completed" : "needsAction",
    // O Google guarda só a data do prazo: a hora local fica apenas no app.
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    completed: done ? (task.completedAt ?? task.updatedAt) : null,
  };
}

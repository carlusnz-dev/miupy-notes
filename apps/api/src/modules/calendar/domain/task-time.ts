import { AppError } from "../../../core/domain/app-error.js";
import { isRealDate } from "./event-time.js";
import type { TaskSchedule } from "./task-schedule.js";

const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const invalid = (message: string) => new AppError(400, "VALIDATION_ERROR", message);

/** Valida o prazo na fronteira: data real, hora HH:MM e hora só com data. */
export function normalizeSchedule(input: { dueDate?: string | null; dueTime?: string | null }): TaskSchedule {
  const dueDate = input.dueDate ?? null, dueTime = input.dueTime ?? null;
  if (dueDate !== null && !isRealDate(dueDate)) throw invalid("A data da tarefa deve ser AAAA-MM-DD.");
  if (dueTime !== null && !clock.test(dueTime)) throw invalid("A hora da tarefa deve ser HH:MM.");
  if (dueTime !== null && dueDate === null) throw invalid("Informe a data para definir a hora da tarefa.");
  return { dueDate, dueTime };
}

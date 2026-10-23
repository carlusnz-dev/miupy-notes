import { OwnedEntity } from "../../../core/domain/owned-entity.js";
import type { TaskSchedule } from "./task-schedule.js";

export type TaskStatus = "pending" | "completed";
/** Cópia da tarefa no Google Tasks; só existe com a sincronização ligada (desligada por padrão). */
export type TaskExternalRef = { readonly provider: "google"; readonly taskListId: string; readonly taskId: string; readonly syncedAt: string };

export class CalendarTask extends OwnedEntity implements TaskSchedule {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly title: string,
    public readonly description: string,
    /** Data AAAA-MM-DD do prazo; `null` = sem data. */
    public readonly dueDate: string | null,
    /** HH:MM de relógio local; exige `dueDate`. */
    public readonly dueTime: string | null,
    public readonly status: TaskStatus,
    public readonly completedAt: string | null,
    public readonly external: TaskExternalRef | null,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number,
  ) { super(); }
}

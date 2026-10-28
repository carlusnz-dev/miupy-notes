import { OwnedEntity } from "../../../core/domain/owned-entity.js";
import type { HabitOutput } from "../dto/output.js";

/** Cadastro do hábito. A ocorrência não é gravada: deriva da recorrência por data (veja `recurrence.ts`). */
export class Habit extends OwnedEntity {
  readonly id: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly kind: HabitOutput["kind"];
  readonly priority: HabitOutput["priority"];
  readonly recurrence: HabitOutput["recurrence"];
  readonly startDate: string;
  readonly endDate: string | null;
  readonly time: string | null;
  readonly pauses: HabitOutput["pauses"];
  /** Exclusão lógica: preenchidos juntos; `purgeAfter` = `deletedAt` + 30 dias. */
  readonly deletedAt: string | null;
  readonly purgeAfter: string | null;

  constructor(ownerId: string, data: HabitOutput) {
    super();
    this.ownerId = ownerId;
    this.id = data.id; this.createdAt = data.createdAt; this.updatedAt = data.updatedAt; this.version = data.version;
    this.title = data.title; this.description = data.description; this.kind = data.kind; this.priority = data.priority;
    this.recurrence = data.recurrence; this.startDate = data.startDate; this.endDate = data.endDate; this.time = data.time;
    this.pauses = data.pauses; this.deletedAt = data.deletedAt; this.purgeAfter = data.purgeAfter;
  }
}

/** Execução concluída. Guarda um retrato do hábito para o histórico sobreviver à exclusão permanente do cadastro. */
export type HabitLog = {
  ownerId: string; habitId: string; date: string; completedAt: string;
  title: string; kind: HabitOutput["kind"]; priority: HabitOutput["priority"];
};

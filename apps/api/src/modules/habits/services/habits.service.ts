import { BaseService } from "../../../core/services/base.service.js";
import type { Habit, HabitLog } from "../domain/habit.js";
import type { CreateHabitInput, DateRangeQuery, PauseInput, ResumeInput, UpdateHabitInput } from "../dto/input.js";
import type { OccurrenceOutput, XpOutput } from "../dto/output.js";
import { HabitsRepository } from "../repository/habits.repository.js";

export abstract class HabitsService extends BaseService<Habit, HabitsRepository> {
  abstract create(ownerId: string, input: CreateHabitInput): Promise<Habit>;
  abstract findById(ownerId: string, id: string): Promise<Habit>;
  /** Ativos (padrão) ou na lixeira ainda dentro do prazo de 30 dias. */
  abstract list(ownerId: string, trash: boolean): Promise<Habit[]>;
  abstract update(ownerId: string, id: string, input: UpdateHabitInput): Promise<Habit>;
  abstract pause(ownerId: string, id: string, input: PauseInput): Promise<Habit>;
  abstract resume(ownerId: string, id: string, input: ResumeInput): Promise<Habit>;
  abstract remove(ownerId: string, id: string): Promise<Habit>;
  abstract restore(ownerId: string, id: string): Promise<Habit>;
  /** Remove fisicamente só o cadastro vencido; execuções e XP ficam. Para a rotina futura de expurgo. */
  abstract purgeExpired(ownerId: string): Promise<number>;
  abstract occurrences(ownerId: string, range: DateRangeQuery): Promise<OccurrenceOutput[]>;
  abstract setOccurrence(ownerId: string, habitId: string, date: string, status: "completed" | "pending"): Promise<OccurrenceOutput>;
  abstract history(ownerId: string, range: DateRangeQuery): Promise<HabitLog[]>;
  abstract xp(ownerId: string): Promise<XpOutput>;
}

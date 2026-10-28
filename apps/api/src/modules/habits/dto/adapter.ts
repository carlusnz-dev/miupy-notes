import type { ZodType } from "zod";
import { parseInternal } from "../../../core/domain/app-error.js";
import type { Habit, HabitLog } from "../domain/habit.js";
import { pointsFor } from "../domain/xp.js";
import {
  habitListOutputSchema, habitOutputSchema, historyOutputSchema, occurrenceListOutputSchema, xpOutputSchema,
  type OccurrenceOutput, type XpOutput,
} from "./output.js";

/** Saída que não passa no próprio schema é bug ou dado corrompido: `parseInternal` vira 500, não 400. */
const output = <T>(schema: ZodType<T>, value: unknown) => parseInternal(schema, value, { service: "Hábitos", operation: "montar a resposta" });

/** `ownerId` nunca sai: os schemas de saída descartam campos desconhecidos. */
export class HabitDtoAdapter {
  static toOutput(habit: Habit) { return output(habitOutputSchema, habit); }
  static toListOutput(habits: Habit[]) { return output(habitListOutputSchema, { items: habits.map(HabitDtoAdapter.toOutput) }); }
  static toOccurrences(items: OccurrenceOutput[]) { return output(occurrenceListOutputSchema, { items }); }
  static toHistory(logs: HabitLog[]) { return output(historyOutputSchema, { items: logs }); }
  static toXp(xp: XpOutput) { return output(xpOutputSchema, xp); }
  static occurrence(habit: Habit, date: string, log: HabitLog | undefined): OccurrenceOutput {
    return {
      habitId: habit.id, date, time: habit.time, title: habit.title, kind: habit.kind, priority: habit.priority,
      status: log ? "completed" : "pending", completedAt: log?.completedAt ?? null, points: pointsFor("completion", habit.priority),
    };
  }
}

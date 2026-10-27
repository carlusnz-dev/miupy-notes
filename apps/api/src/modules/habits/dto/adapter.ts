import type { Habit, HabitLog } from "../domain/habit.js";
import { pointsFor } from "../domain/xp.js";
import {
  habitListOutputSchema, habitOutputSchema, historyOutputSchema, occurrenceListOutputSchema, xpOutputSchema,
  type OccurrenceOutput, type XpOutput,
} from "./output.js";

/** `ownerId` nunca sai: os schemas de saída descartam campos desconhecidos. */
export class HabitDtoAdapter {
  static toOutput(habit: Habit) { return habitOutputSchema.parse(habit); }
  static toListOutput(habits: Habit[]) { return habitListOutputSchema.parse({ items: habits.map(HabitDtoAdapter.toOutput) }); }
  static toOccurrences(items: OccurrenceOutput[]) { return occurrenceListOutputSchema.parse({ items }); }
  static toHistory(logs: HabitLog[]) { return historyOutputSchema.parse({ items: logs }); }
  static toXp(xp: XpOutput) { return xpOutputSchema.parse(xp); }
  static occurrence(habit: Habit, date: string, log: HabitLog | undefined): OccurrenceOutput {
    return {
      habitId: habit.id, date, time: habit.time, title: habit.title, kind: habit.kind, priority: habit.priority,
      status: log ? "completed" : "pending", completedAt: log?.completedAt ?? null, points: pointsFor("completion", habit.priority),
    };
  }
}

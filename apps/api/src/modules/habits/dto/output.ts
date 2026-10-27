import { z } from "zod";
import { habitFields } from "./input.js";

export const habitOutputSchema = z.object({
  ...habitFields, id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.int().positive(),
  pauses: z.array(z.object({ from: z.iso.date(), until: z.iso.date().nullable() })),
  deletedAt: z.iso.datetime().nullable(), purgeAfter: z.iso.datetime().nullable(),
});
export const habitListOutputSchema = z.object({ items: z.array(habitOutputSchema) });

/** Ocorrência derivada (hábito × data). `status` vem do registro de execução; sem registro, `pending`. */
export const occurrenceOutputSchema = z.object({
  habitId: z.uuid(), date: z.iso.date(), time: habitFields.time, title: z.string(), kind: habitFields.kind, priority: habitFields.priority,
  status: z.enum(["completed", "pending"]), completedAt: z.iso.datetime().nullable(), points: z.int().positive(),
});
export const occurrenceListOutputSchema = z.object({ items: z.array(occurrenceOutputSchema) });

export const historyItemOutputSchema = z.object({
  habitId: z.uuid(), date: z.iso.date(), completedAt: z.iso.datetime(), title: z.string(), kind: habitFields.kind, priority: habitFields.priority,
});
export const historyOutputSchema = z.object({ items: z.array(historyItemOutputSchema) });

export const xpOutputSchema = z.object({
  totalXp: z.int().nonnegative(), level: z.int().positive(), levelXp: z.int().nonnegative(), nextLevelXp: z.int().positive(),
  completions: z.int().nonnegative(), achievements: z.array(z.object({ id: z.string(), title: z.string(), unlocked: z.boolean() })),
});
export const settingsOutputSchema = z.object({ googleCalendar: z.object({ enabled: z.boolean(), available: z.boolean() }) });

export type HabitOutput = z.infer<typeof habitOutputSchema>;
export type HabitListOutput = z.infer<typeof habitListOutputSchema>;
export type OccurrenceOutput = z.infer<typeof occurrenceOutputSchema>;
export type OccurrenceListOutput = z.infer<typeof occurrenceListOutputSchema>;
export type HistoryOutput = z.infer<typeof historyOutputSchema>;
export type XpOutput = z.infer<typeof xpOutputSchema>;
export type SettingsOutput = z.infer<typeof settingsOutputSchema>;

import { z } from "zod";

const date = z.iso.date();
export const recurrenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("daily"), every: z.int().min(1).max(365).default(1) }),
  z.strictObject({ type: z.literal("weekly"), every: z.int().min(1).max(52).default(1) }),
  z.strictObject({ type: z.literal("weekdays"), days: z.array(z.int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, "Dias repetidos.") }),
]);

export const habitFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000),
  kind: z.enum(["health", "study", "work", "personal", "other"]),
  priority: z.enum(["low", "medium", "high"]),
  recurrence: recurrenceSchema,
  startDate: date,
  endDate: date.nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
};

export const validRange = (input: { startDate?: string; endDate?: string | null }) =>
  !input.startDate || !input.endDate || input.startDate <= input.endDate;
const rangeMessage = { message: "A data final deve ser igual ou posterior ao início." };

export const createHabitInputSchema = z.strictObject({
  ...habitFields,
  description: habitFields.description.default(""), kind: habitFields.kind.default("other"),
  priority: habitFields.priority.default("medium"), endDate: habitFields.endDate.default(null), time: habitFields.time.default(null),
}).refine(validRange, rangeMessage);

export const updateHabitInputSchema = z.strictObject({ ...z.strictObject(habitFields).partial().shape, version: z.int().positive() })
  .refine(input => Object.keys(input).some(key => key !== "version"))
  .refine(validRange, rangeMessage);

export const pauseInputSchema = z.strictObject({ version: z.int().positive(), from: date, until: date.nullable().default(null) })
  .refine(input => input.until === null || input.until > input.from, { message: "A retomada deve ser posterior ao início da pausa." });
export const resumeInputSchema = z.strictObject({ version: z.int().positive(), on: date });

export const listHabitsQuerySchema = z.strictObject({ trash: z.enum(["true", "false"]).default("false").transform(value => value === "true") });

/** Intervalo inclusivo de datas locais; limite protege a derivação e a leitura. */
export const MAX_OCCURRENCE_DAYS = 62;
export const MAX_HISTORY_DAYS = 366;
const rangeQuery = (maxDays: number) => z.strictObject({ from: date, to: date })
  .refine(({ from, to }) => from <= to, { message: "O início deve ser anterior ou igual ao fim." })
  .refine(({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 < maxDays, { message: `O intervalo não pode passar de ${maxDays} dias.` });
export const occurrencesQuerySchema = rangeQuery(MAX_OCCURRENCE_DAYS);
export const historyQuerySchema = rangeQuery(MAX_HISTORY_DAYS);

export const occurrenceStatusInputSchema = z.strictObject({ status: z.enum(["completed", "pending"]) });
export const occurrenceDateSchema = date;

export type CreateHabitInput = z.infer<typeof createHabitInputSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitInputSchema>;
export type PauseInput = z.infer<typeof pauseInputSchema>;
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type DateRangeQuery = z.infer<typeof occurrencesQuerySchema>;

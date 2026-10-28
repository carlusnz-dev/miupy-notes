import type { HabitInput } from "../lib/habits-api";

export type HabitFormValues = {
  title: string; description: string; kind: HabitInput["kind"]; priority: HabitInput["priority"];
  recurrence: HabitInput["recurrence"]["type"]; every: string; days: number[];
  startDate: string; endDate: string; time: string;
};
export type HabitField = "title" | "description" | "every" | "days" | "startDate" | "endDate" | "time";
export type HabitFormErrors = Partial<Record<HabitField, string>>;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida o que a API também valida, só para dar o erro ao lado do campo; a API segue sendo a autoridade. */
export function buildHabitInput(values: HabitFormValues): { input: HabitInput } | { errors: HabitFormErrors } {
  const errors: HabitFormErrors = {};
  const title = values.title.trim(), description = values.description.trim();
  if (!title) errors.title = "Informe o título."; else if (title.length > 200) errors.title = "Use até 200 caracteres.";
  if (description.length > 1000) errors.description = "Use até 1000 caracteres.";
  if (!values.startDate) errors.startDate = "Informe a data de início.";
  if (values.endDate && values.startDate && values.endDate < values.startDate) errors.endDate = "A data final deve ser igual ou posterior ao início.";
  if (values.time && !timePattern.test(values.time)) errors.time = "Use o formato HH:MM.";
  const every = Number(values.every);
  const max = values.recurrence === "daily" ? 365 : 52;
  if (values.recurrence !== "weekdays" && !(Number.isInteger(every) && every >= 1 && every <= max)) errors.every = `Informe um número de 1 a ${max}.`;
  if (values.recurrence === "weekdays" && values.days.length === 0) errors.days = "Escolha ao menos um dia.";
  if (Object.keys(errors).length) return { errors };
  const recurrence: HabitInput["recurrence"] = values.recurrence === "weekdays" ? { type: "weekdays", days: [...values.days].sort((a, b) => a - b) } : { type: values.recurrence, every };
  return { input: { title, description, kind: values.kind, priority: values.priority, recurrence, startDate: values.startDate, endDate: values.endDate || null, time: values.time || null } };
}
export const firstInvalid = (errors: HabitFormErrors): HabitField | undefined =>
  (["title", "description", "every", "days", "startDate", "endDate", "time"] as const).find(field => errors[field]);

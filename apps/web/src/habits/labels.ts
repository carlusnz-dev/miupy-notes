import type { Habit } from "../lib/habits-api";

export const kinds = [
  { value: "health", label: "Saúde" }, { value: "study", label: "Estudo" }, { value: "work", label: "Trabalho" },
  { value: "personal", label: "Pessoal" }, { value: "other", label: "Outro" },
] as const;
export const priorities = [{ value: "low", label: "Baixa" }, { value: "medium", label: "Média" }, { value: "high", label: "Alta" }] as const;
export const recurrenceTypes = [{ value: "daily", label: "Todo dia" }, { value: "weekly", label: "Toda semana" }, { value: "weekdays", label: "Dias da semana" }] as const;
/** Índice = dia da semana da API (0 = domingo). */
export const weekdayShort = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const kindLabel = (kind: Habit["kind"]) => kinds.find(item => item.value === kind)!.label;
export const priorityLabel = (priority: Habit["priority"]) => priorities.find(item => item.value === priority)!.label;

export function recurrenceLabel(recurrence: Habit["recurrence"]): string {
  switch (recurrence.type) {
    case "daily": return recurrence.every === 1 ? "Todo dia" : `A cada ${recurrence.every} dias`;
    case "weekly": return recurrence.every === 1 ? "Toda semana" : `A cada ${recurrence.every} semanas`;
    case "weekdays": return [...recurrence.days].sort((a, b) => a - b).map(day => weekdayShort[day]).join(", ");
  }
}

/** A pausa que vale hoje ou ainda vai valer (para decidir entre "Pausar" e "Retomar"); só exibição, a regra é da API. */
export const currentPause = (pauses: Habit["pauses"], today: string) => pauses.find(pause => pause.until === null || pause.until > today);

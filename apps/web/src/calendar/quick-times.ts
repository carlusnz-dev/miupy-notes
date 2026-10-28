import type { Fields } from "./draft";

export type QuickDuration = "30" | "60" | "120" | "day";
/** Chips de duração da criação rápida; o início vem do horário tocado e só muda em "Mais opções". */
export const quickDurations = [
  { value: "30", label: "30 min" }, { value: "60", label: "1 h" }, { value: "120", label: "2 h" }, { value: "day", label: "Dia inteiro" },
] as const satisfies readonly { value: QuickDuration; label: string }[];

const pad = (value: number) => String(value).padStart(2, "0");

/** Horário final de "início + duração" no mesmo dia: passou da meia-noite, fecha às 23:59 (como o cartão sempre fez). */
export function endClock(startTime: string, minutes: number): string {
  const total = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + minutes;
  return total >= 1440 ? "23:59" : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Aplica o chip escolhido aos campos do evento (dia inteiro ou fim = início + duração, no mesmo dia). */
export function applyDuration(fields: Fields, duration: QuickDuration): Fields {
  if (duration === "day") return { ...fields, allDay: true, endDate: fields.startDate };
  return { ...fields, allDay: false, endDate: fields.startDate, endTime: endClock(fields.startTime, Number(duration)) };
}

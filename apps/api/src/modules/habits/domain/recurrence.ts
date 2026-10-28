/**
 * Recorrência por data local do usuário (AAAA-MM-DD), sem fuso: as datas são do calendário de parede e a
 * aritmética usa dias inteiros desde 1970-01-01 em UTC só como contador, o que ignora horário de verão e
 * vira mês/ano/bissexto corretamente. O servidor nunca converte instantes em datas do usuário.
 */
export type Recurrence =
  | { type: "daily"; every: number }
  | { type: "weekly"; every: number }
  /** Dias da semana, 0 = domingo … 6 = sábado. */
  | { type: "weekdays"; days: number[] };

export type PauseWindow = { from: string; until: string | null };

export type Schedule = { recurrence: Recurrence; startDate: string; endDate: string | null; pauses: PauseWindow[] };

const DAY_MS = 86_400_000;
export const epochDay = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
export const dateOfEpochDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** 1970-01-01 foi quinta-feira. */
export const weekdayOf = (date: string) => (((epochDay(date) + 4) % 7) + 7) % 7;
export const addDays = (date: string, days: number) => dateOfEpochDay(epochDay(date) + days);

/** Pausa em [from, until): `until` é o primeiro dia de volta; `null` = sem data para retomar. */
export const isPaused = (pauses: readonly PauseWindow[], date: string) =>
  pauses.some((pause) => date >= pause.from && (pause.until === null || date < pause.until));

function matchesRecurrence(recurrence: Recurrence, startDate: string, date: string): boolean {
  const offset = epochDay(date) - epochDay(startDate);
  switch (recurrence.type) {
    case "daily": return offset % recurrence.every === 0;
    case "weekly": return offset % (7 * recurrence.every) === 0;
    case "weekdays": return recurrence.days.includes(weekdayOf(date));
  }
}

/** O hábito gera ocorrência nesta data (ignora exclusão lógica, que é do cadastro). */
export function occursOn(schedule: Schedule, date: string): boolean {
  if (date < schedule.startDate || (schedule.endDate !== null && date > schedule.endDate)) return false;
  return !isPaused(schedule.pauses, date) && matchesRecurrence(schedule.recurrence, schedule.startDate, date);
}

export function occurrenceDates(schedule: Schedule, from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = epochDay(from); day <= epochDay(to); day++) {
    const date = dateOfEpochDay(day);
    if (occursOn(schedule, date)) dates.push(date);
  }
  return dates;
}

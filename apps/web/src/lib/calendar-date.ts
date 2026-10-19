// Datas de calendário como AAAA-MM-DD, só com aritmética de inteiros: sem Date/UTC, logo sem desvio de fuso.
export type CalendarDate = { year: number; month: number; day: number };

export const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function daysInMonth(year: number, month: number) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
export function isValidDate({ year, month, day }: CalendarDate) {
  return Number.isInteger(year) && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
/** 0 = domingo (algoritmo de Sakamoto). */
export function weekday({ year, month, day }: CalendarDate) {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7;
}
export function addDays(date: CalendarDate, delta: number): CalendarDate {
  let { year, month, day } = date;
  day += delta;
  while (day < 1) { month -= 1; if (month < 1) { month = 12; year -= 1; } day += daysInMonth(year, month); }
  while (day > daysInMonth(year, month)) { day -= daysInMonth(year, month); month += 1; if (month > 12) { month = 1; year += 1; } }
  return { year, month, day };
}
/** Soma meses mantendo o dia, limitado ao último dia do mês de destino (31/01 + 1 mês = 28/02). */
export function addMonths({ year, month, day }: CalendarDate, delta: number): CalendarDate {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12), nextMonth = (index % 12 + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth, day: Math.min(day, daysInMonth(nextYear, nextMonth)) };
}
export function toIso({ year, month, day }: CalendarDate) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function fromIso(iso: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidDate(date) ? date : null;
}
export function toDisplay(date: CalendarDate) {
  return `${String(date.day).padStart(2, "0")}/${String(date.month).padStart(2, "0")}/${String(date.year).padStart(4, "0")}`;
}
/** Texto "dd/mm/aaaa" completo e real; senão null. */
export function fromDisplay(text: string): CalendarDate | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const date = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  return isValidDate(date) ? date : null;
}
/** Máscara ao vivo: mantém só dígitos (até 8) e insere as barras. */
export function maskDisplay(text: string) {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter((part, index) => part || index === 0).join("/");
}
export function todayLocal(now = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
export function compare(a: CalendarDate, b: CalendarDate) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

const day = new Intl.DateTimeFormat('pt-BR');
const dayTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "2026-08-25" → "25/08/2026", sem passar por UTC (a data é do calendário, não um instante). */
export function formatDate(date: string) {
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  return day.format(new Date(year, month - 1, dayOfMonth));
}
/** Instante ISO → "25/08/2026, 18:46" no fuso local. */
export function formatDateTime(iso: string) {
  return dayTime.format(new Date(iso));
}

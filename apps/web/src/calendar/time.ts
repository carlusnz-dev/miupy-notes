// Conversões entre "relógio de parede" num fuso IANA e instantes UTC, só com Intl (sem biblioteca de datas).
export type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(timeZone, found);
  }
  return found;
}

export function isValidZone(timeZone: string): boolean {
  try { formatter(timeZone); return timeZone.length > 0; } catch { return false; }
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidZone(zone) ? zone : "UTC";
}

/** Deslocamento (UTC → fuso) em ms no instante dado; positivo a leste de UTC. */
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instantMs)).map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export function wallTimeInZone(instant: string | number, timeZone: string): WallTime {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  const shifted = new Date(ms + offsetMs(ms, timeZone));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

/**
 * Instante UTC (ISO) de um horário de parede num fuso. Em horário inexistente (salto do horário de verão) usa o
 * deslocamento anterior ao salto; em horário repetido, a primeira ocorrência.
 */
export function wallTimeToInstant(wall: WallTime, timeZone: string): string {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = naive - offsetMs(naive, timeZone);
  const corrected = naive - offsetMs(guess, timeZone);
  if (corrected !== guess) guess = naive - offsetMs(corrected, timeZone) === corrected ? corrected : guess;
  return new Date(guess).toISOString();
}

const pad = (value: number) => String(value).padStart(2, "0");
export const wallDate = (wall: Pick<WallTime, "year" | "month" | "day">) => `${String(wall.year).padStart(4, "0")}-${pad(wall.month)}-${pad(wall.day)}`;
export const wallClock = (wall: Pick<WallTime, "hour" | "minute">) => `${pad(wall.hour)}:${pad(wall.minute)}`;

/** Lê "AAAA-MM-DD" + "HH:MM"; `null` se algum for inválido. */
export function parseWall(date: string, clock: string): WallTime | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), c = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!d || !c) return null;
  const wall = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(c[1]), minute: Number(c[2]) };
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (check.getUTCFullYear() !== wall.year || check.getUTCMonth() + 1 !== wall.month || check.getUTCDate() !== wall.day || wall.hour > 23 || wall.minute > 59) return null;
  return wall;
}

/** Fusos oferecidos no formulário: o do navegador, o do evento e os mais comuns do proprietário. */
export function zoneChoices(...extra: Array<string | null | undefined>): string[] {
  const common = ["America/Sao_Paulo", "America/New_York", "Europe/Lisbon", "Europe/London", "UTC"];
  return [...new Set([...extra.filter((zone): zone is string => !!zone && isValidZone(zone)), ...common])];
}

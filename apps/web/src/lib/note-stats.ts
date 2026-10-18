import type { NoteOutput } from "./notes-api";

export type DayCount = { date: string; count: number };
export type TagCount = { tag: string; count: number };
export type NoteStats = {
  total: number;
  createdInWindow: number;
  windowDays: number;
  words: number;
  tags: TagCount[];
  /** Notas criadas por dia, do mais antigo ao mais recente, com zeros nos dias vazios. */
  createdPerDay: DayCount[];
};

const DAY_MS = 86_400_000;

/** Conta sequências de letras/números; marcação Markdown (`**`, `#`, `-`) não vira palavra. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Data local AAAA-MM-DD, para agrupar por dia no fuso do usuário. */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function computeNoteStats(notes: NoteOutput[], windowDays = 30, now = new Date()): NoteStats {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (windowDays - 1));
  const perDay = new Map<string, number>();
  for (let index = 0; index < windowDays; index++) perDay.set(localDay(new Date(start.getTime() + index * DAY_MS + DAY_MS / 2)), 0);

  const tags = new Map<string, number>();
  let words = 0;
  let createdInWindow = 0;
  for (const note of notes) {
    words += countWords(note.body);
    for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const day = localDay(new Date(note.createdAt));
    if (perDay.has(day)) {
      perDay.set(day, perDay.get(day)! + 1);
      createdInWindow++;
    }
  }

  return {
    total: notes.length,
    createdInWindow,
    windowDays,
    words,
    tags: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "pt-BR")),
    createdPerDay: [...perDay].map(([date, count]) => ({ date, count })),
  };
}

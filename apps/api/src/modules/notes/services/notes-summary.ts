import type { NoteSummaryQuery } from "../dto/input.js";
import type { NoteSummaryOutput } from "../dto/output.js";
import type { NotesRepository } from "../repository/notes.repository.js";

const DAY_MS = 86_400_000;
const countWords = (body: string) => body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;

/** Agrega página a página: sem teto silencioso e sem reter todos os corpos em memória. */
export async function summarizeNotes(repository: NotesRepository, ownerId: string, query: NoteSummaryQuery, now = new Date()): Promise<NoteSummaryOutput> {
  const offset = query.offsetMinutes * 60_000;
  const localDay = (date: string | number) => new Date(new Date(date).getTime() + offset).toISOString().slice(0, 10);
  const today = Date.parse(`${localDay(now.getTime())}T00:00:00Z`);
  const perDay = new Map(Array.from({ length: query.days }, (_, index) => [new Date(today - (query.days - 1 - index) * DAY_MS).toISOString().slice(0, 10), 0]));
  const tags = new Map<string, number>();
  const summary: NoteSummaryOutput = { total: 0, words: 0, characters: 0, averageWords: 0, first: null, last: null, windowDays: query.days, createdInWindow: 0, createdPerDay: [], tags: [], topNotes: [] };
  let cursor: string | undefined;
  do {
    const page = await repository.list(ownerId, 100, cursor);
    for (const note of page.items) {
      const words = countWords(note.body);
      summary.total++;
      summary.words += words;
      summary.characters += note.body.length;
      if (summary.first === null || note.createdAt < summary.first) summary.first = note.createdAt;
      if (summary.last === null || note.createdAt > summary.last) summary.last = note.createdAt;
      for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      const day = localDay(note.createdAt);
      if (perDay.has(day)) { perDay.set(day, perDay.get(day)! + 1); summary.createdInWindow++; }
      summary.topNotes.push({ title: note.title, words });
      summary.topNotes.sort((a, b) => b.words - a.words || a.title.localeCompare(b.title, "pt-BR"));
      summary.topNotes.length = Math.min(10, summary.topNotes.length);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  summary.averageWords = summary.total ? Math.round(summary.words / summary.total) : 0;
  summary.tags = [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "pt-BR"));
  summary.createdPerDay = [...perDay].map(([date, count]) => ({ date, count }));
  return summary;
}

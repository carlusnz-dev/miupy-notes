import type { CalendarDate } from "../lib/calendar-date";
import type { ViewMode } from "./layout";

/** Período reconciliado com o servidor há menos que isto não é buscado de novo; os eventos vêm do IndexedDB. */
export const FRESH_MS = 2 * 60_000;

/**
 * Memória da Agenda por conta, no módulo: sobrevive a trocar de página e de vista. Guarda só quando cada período foi
 * reconciliado, a última vista aberta e respostas auxiliares pequenas (notas para vincular, status do Google); nunca
 * eventos, que ficam no `CalendarStore`.
 */
export function createFetchCache(freshMs = FRESH_MS) {
  const fetchedAt = new Map<string, number>();
  const views = new Map<string, { mode: ViewMode; anchor: CalendarDate }>();
  const values = new Map<string, { at: number; value: unknown }>();
  const key = (ownerId: string, range: string) => `${ownerId}\u0000${range}`;
  return {
    /** Instante da última reconciliação ainda fresca, ou `null` se precisa buscar. */
    freshAt(ownerId: string, range: string, now = Date.now()): number | null {
      const at = fetchedAt.get(key(ownerId, range));
      return at !== undefined && now - at < freshMs ? at : null;
    },
    mark(ownerId: string, range: string, at = Date.now()) { fetchedAt.set(key(ownerId, range), at); },
    /** Após envio, conflito, mudança durante a busca ou "atualizar": a próxima vista busca de novo. */
    invalidate(ownerId: string) {
      for (const k of fetchedAt.keys()) if (k.startsWith(`${ownerId}\u0000`)) fetchedAt.delete(k);
    },
    /** Resposta auxiliar (lista de notas, status do Google) ainda fresca, ou `undefined`. */
    recall<T>(ownerId: string, name: string, now = Date.now()): T | undefined {
      const entry = values.get(key(ownerId, name));
      return entry && now - entry.at < freshMs ? (entry.value as T) : undefined;
    },
    remember(ownerId: string, name: string, value: unknown, at = Date.now()) { values.set(key(ownerId, name), { at, value }); },
    lastView: (ownerId: string) => views.get(ownerId) ?? null,
    saveView(ownerId: string, mode: ViewMode, anchor: CalendarDate) { views.set(ownerId, { mode, anchor }); },
  };
}

export const calendarFetchCache = createFetchCache();
export const rangeKey = (range: { from: string; to: string }) => `${range.from}/${range.to}`;
export const UPCOMING_KEY = "upcoming";

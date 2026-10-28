import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { NoteMetadataListOutput, NoteMetadataOutput, NoteOutput } from "./notes-api";

// Chaves sem filtros: listas preservam a ordem estável por ID do contrato.
export const noteKeys = {
  all: ["notes"] as const,
  list: () => [...noteKeys.all, "list"] as const,
  everything: () => [...noteKeys.all, "everything"] as const,
  summaries: () => [...noteKeys.all, "summary"] as const,
  summary: (days: number, offset: number) => [...noteKeys.all, "summary", days, offset] as const,
  detail: (id: string) => [...noteKeys.all, "detail", id] as const,
};

const deletedNotes = new WeakMap<QueryClient, Set<string>>();

/** Atualiza só registros conhecidos; não insere nota em páginas nem modifica rascunhos da fila. */
export function cacheSavedNote(client: QueryClient, note: NoteOutput) {
  if (deletedNotes.get(client)?.has(note.id)) return;
  const previous = client.getQueryData<NoteOutput>(noteKeys.detail(note.id));
  if (previous && previous.version > note.version) return;
  const { body: _body, ...metadata } = note;
  const patch = (item: NoteMetadataOutput) => item.id === note.id && item.version <= note.version ? metadata : item;
  client.setQueryData(noteKeys.detail(note.id), note);
  client.setQueriesData<InfiniteData<NoteMetadataListOutput>>({ queryKey: noteKeys.list() }, (data) => data && ({
    ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(patch) })),
  }));
  client.setQueriesData<{ items: NoteMetadataOutput[]; truncated: boolean }>({ queryKey: noteKeys.everything() }, (data) => data && ({ ...data, items: data.items.map(patch) }));
  void client.invalidateQueries({ queryKey: [...noteKeys.all, "recent-candidates"] });
  // Movimentar pasta não altera métricas. O resumo não devolve a coleção nem os corpos.
  if (!previous || previous.body !== note.body || previous.title !== note.title || JSON.stringify(previous.tags) !== JSON.stringify(note.tags)) {
    void client.invalidateQueries({ queryKey: noteKeys.summaries() });
  }
}

export function cacheCreatedNote(client: QueryClient, note: NoteOutput) {
  cacheSavedNote(client, note);
  void client.invalidateQueries({ queryKey: noteKeys.list() });
  void client.invalidateQueries({ queryKey: noteKeys.everything() });
}

export function cacheDeletedNote(client: QueryClient, id: string) {
  const deleted = deletedNotes.get(client) ?? new Set<string>();
  deleted.add(id);
  void client.invalidateQueries({ queryKey: [...noteKeys.all, "recent-candidates"] });
  deletedNotes.set(client, deleted);
  client.removeQueries({ queryKey: noteKeys.detail(id) });
  void client.invalidateQueries({ queryKey: noteKeys.list() });
  void client.invalidateQueries({ queryKey: noteKeys.everything() });
  void client.invalidateQueries({ queryKey: noteKeys.summaries() });
}

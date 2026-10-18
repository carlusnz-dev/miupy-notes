import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { createNote, deleteNote, getNote, listNotes, updateNote, type NoteOutput } from "./notes-api";

// Toda leitura de notas passa por estas chaves; mutações invalidam a raiz `notes`.
export const noteKeys = {
  all: ["notes"] as const,
  list: () => [...noteKeys.all, "list"] as const,
  everything: () => [...noteKeys.all, "everything"] as const,
  detail: (id: string) => [...noteKeys.all, "detail", id] as const,
};

const PAGE_LIMIT = 100;
// Teto para as métricas: 50 páginas × 100 notas. Acima disso as métricas pedem um endpoint de agregação.
const MAX_PAGES = 50;

function useSignedIn() {
  return useAuth().status === "signed-in";
}

/** Lista paginada para a tela de notas ("Carregar mais" chama `fetchNextPage`). */
export function useNotesList(enabled = true) {
  return useInfiniteQuery({
    queryKey: noteKeys.list(),
    queryFn: ({ pageParam, signal }) => listNotes({ cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: useSignedIn() && enabled,
  });
}

/** Todas as notas (até o teto), para métricas e gráficos. `truncated` indica que o teto foi atingido. */
export function useAllNotes(enabled = true) {
  return useQuery({
    queryKey: noteKeys.everything(),
    queryFn: async ({ signal }) => {
      const items: NoteOutput[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await listNotes({ cursor, limit: PAGE_LIMIT, signal });
        items.push(...result.items);
        if (!result.nextCursor) return { items, truncated: false };
        cursor = result.nextCursor;
      }
      return { items, truncated: true };
    },
    enabled: useSignedIn() && enabled,
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: ({ signal }) => getNote(id, signal),
    enabled: useSignedIn() && id !== "",
  });
}

/** Grava a versão nova no cache do detalhe e marca listas/métricas como velhas. */
export function cacheSavedNote(client: QueryClient, note: NoteOutput) {
  client.setQueryData(noteKeys.detail(note.id), note);
  void client.invalidateQueries({ queryKey: noteKeys.list() });
  void client.invalidateQueries({ queryKey: noteKeys.everything() });
}

export function useCreateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createNote,
    onSuccess: (note) => cacheSavedNote(client, note),
  });
}

export function useUpdateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof updateNote>[1]) => updateNote(id, input),
    onSuccess: (note) => cacheSavedNote(client, note),
  });
}

export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteNote,
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: noteKeys.detail(id) });
      void client.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

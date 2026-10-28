import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthSessionVersion, isCurrentAuthSession, useAuth } from "./auth";
import { createNote, deleteNote, getNote, listNotesMetadata, getNotesSummary, updateNote, type NoteMetadataOutput } from "./notes-api";

import { noteKeys, cacheSavedNote, cacheCreatedNote, cacheDeletedNote } from "./notes-queries-cache";
export { noteKeys, cacheSavedNote } from "./notes-queries-cache";

const PAGE_LIMIT = 100;
// Teto explícito da árvore; métricas usam summary sem esse teto.
const MAX_PAGES = 50;

function useSignedIn() {
  return useAuth().status === "signed-in";
}

/** Lista paginada para a tela de notas ("Carregar mais" chama `fetchNextPage`). */
export function useNotesList(enabled = true) {
  return useInfiniteQuery({
    queryKey: noteKeys.list(),
    queryFn: ({ pageParam, signal }) => listNotesMetadata({ cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: useSignedIn() && enabled,
  });
}

/** Metadados compartilhados entre árvore e seleção de vínculos da Agenda. */
export function allNotesOptions() {
  return {
    queryKey: noteKeys.everything(),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const items: NoteMetadataOutput[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await listNotesMetadata({ cursor, limit: PAGE_LIMIT, signal });
        items.push(...result.items);
        if (!result.nextCursor) return { items, truncated: false };
        cursor = result.nextCursor;
      }
      return { items, truncated: true };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  };
}
export function useAllNotes(enabled = true) {
  return useQuery({ ...allNotesOptions(), enabled: useSignedIn() && enabled });
}

/** Uma página, sem percorrer o acervo. Ordem por ID: só há garantia de mais recente se couber na página. */
export function useRecentNoteCandidates(enabled = true) {
  return useQuery({
    queryKey: [...noteKeys.all, "recent-candidates"],
    queryFn: ({ signal }) => listNotesMetadata({ limit: PAGE_LIMIT, signal }),
    enabled: useSignedIn() && enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: ({ signal }) => getNote(id, signal),
    enabled: useSignedIn() && id !== "",
  });
}

export function useNotesSummary(days: 7 | 30 | 90 = 30, enabled = true) {
  const offset = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: noteKeys.summary(days, offset),
    queryFn: ({ signal }) => getNotesSummary(days, offset, signal),
    enabled: useSignedIn() && enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createNote,
    onMutate: () => getAuthSessionVersion(),
    onSuccess: (note, _input, session) => { if (isCurrentAuthSession(session)) cacheCreatedNote(client, note); },
  });
}

export function useUpdateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof updateNote>[1]) => updateNote(id, input),
    onMutate: () => getAuthSessionVersion(),
    onSuccess: (note, _input, session) => { if (isCurrentAuthSession(session)) cacheSavedNote(client, note); },
  });
}

export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteNote,
    onMutate: () => getAuthSessionVersion(),
    onSuccess: (_, id, session) => {
      if (!isCurrentAuthSession(session)) return;
      cacheDeletedNote(client, id);
    },
  });
}

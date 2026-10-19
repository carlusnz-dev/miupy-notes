import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";
import { useCreateFolder, useFolders, useUpdateFolder } from "./notes-folders-queries";
import type { FolderOutput } from "./notes-folders-api";
import type { NoteOutput } from "./notes-api";
import { useAllNotes, useCreateNote, useUpdateNote } from "./notes-queries";

/** Título provisório aceito pelo contrato: a nota nasce sem input prévio e o usuário renomeia no editor. */
export const UNTITLED = "Sem título";
export const NEW_FOLDER_NAME = "Nova pasta";

export type Workspace = {
  status: "loading" | "ready" | "error";
  error: ApiError | null;
  /** Há mais notas do que o teto de carregamento (ver `useAllNotes`). */
  truncated: boolean;
  refreshing: boolean;
  notes: NoteOutput[];
  folders: FolderOutput[];
  retry: () => void;
  /** Cada operação devolve o registro criado; erros sobem como `ApiError`. */
  createNote: (folderId: string | null) => Promise<NoteOutput>;
  createFolder: (parentId: string | null) => Promise<FolderOutput>;
  renameFolder: (folder: FolderOutput, name: string) => Promise<void>;
  moveNote: (note: NoteOutput, folderId: string | null) => Promise<void>;
};

const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo."));

/** Notas e pastas do backend (DynamoDB). Nada é guardado no disco do usuário. */
export function useRemoteWorkspace(enabled: boolean): Workspace {
  const client = useQueryClient();
  const notes = useAllNotes(enabled);
  const folders = useFolders(enabled);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();

  const failed = notes.isError || folders.isError;
  const ready = !!notes.data && !!folders.data;
  const refetch = () => { void notes.refetch(); void folders.refetch(); };
  return {
    status: ready ? "ready" : failed ? "error" : "loading",
    error: failed ? asApiError(notes.error ?? folders.error) : null,
    truncated: notes.data?.truncated ?? false,
    refreshing: notes.isFetching || folders.isFetching,
    notes: notes.data?.items ?? [],
    folders: folders.data?.items ?? [],
    retry: refetch,
    createNote: (folderId) => createNote.mutateAsync({ title: UNTITLED, folderId }),
    createFolder: (parentId) => createFolder.mutateAsync({ name: NEW_FOLDER_NAME, parentId }),
    renameFolder: async (folder, name) => { await updateFolder.mutateAsync({ id: folder.id, version: folder.version, name }); },
    moveNote: async (note, folderId) => {
      if ((note.folderId ?? null) === folderId) return;
      try { await updateNote.mutateAsync({ id: note.id, version: note.version, folderId }); }
      catch (error) { void client.invalidateQueries({ queryKey: ["notes"] }); throw error; }
    },
  };
}

export type PreviewWorkspaceState = "carregando" | "vazio" | "erro" | "arvore";

const ids = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seed(state: PreviewWorkspaceState) {
  const now = new Date().toISOString();
  const folder = (n: number, name: string, parentId: string | null = null): FolderOutput => ({ id: ids(n), name, parentId, createdAt: now, updatedAt: now, version: 1 });
  const note = (n: number, title: string, folderId: string | null, tags: string[] = []): NoteOutput => ({ id: ids(n), title, body: "", tags, folderId, createdAt: now, updatedAt: now, version: 1 });
  if (state !== "arvore") return { folders: [] as FolderOutput[], notes: [] as NoteOutput[] };
  return {
    folders: [folder(1, "Projetos"), folder(2, "2026", ids(1)), folder(3, "Leituras"), folder(4, "Pasta vazia")],
    notes: [
      note(11, "Plano do trimestre", ids(2), ["planejamento", "trabalho"]),
      note(12, "Roteiro da viagem com um título bem longo para testar a quebra de linha e o corte", ids(2)),
      note(13, "Resumo de livro", ids(3), ["livros"]),
      note(14, "Ideias soltas na raiz", null, ["ideias"]),
      note(15, "Lista de compras", null),
    ],
  };
}

/** Só em desenvolvimento (`?estado=`): o mesmo contrato do backend sobre dados sintéticos em memória. */
export function usePreviewWorkspace(state: PreviewWorkspaceState | null): Workspace {
  const [data, setData] = useState(() => seed(state ?? "vazio"));
  const [counter, setCounter] = useState(100);
  const next = useCallback(() => { setCounter((n) => n + 1); return counter + 1; }, [counter]);
  const now = () => new Date().toISOString();
  return {
    status: state === "carregando" ? "loading" : state === "erro" ? "error" : "ready",
    error: state === "erro" ? new ApiError("INTERNAL_ERROR", "Erro interno.", 500, ids(0)) : null,
    truncated: false,
    refreshing: false,
    notes: data.notes,
    folders: data.folders,
    retry: () => {},
    createNote: async (folderId) => {
      const created: NoteOutput = { id: ids(next()), title: UNTITLED, body: "", tags: [], folderId, createdAt: now(), updatedAt: now(), version: 1 };
      setData((current) => ({ ...current, notes: [...current.notes, created] }));
      return created;
    },
    createFolder: async (parentId) => {
      const created: FolderOutput = { id: ids(next()), name: NEW_FOLDER_NAME, parentId, createdAt: now(), updatedAt: now(), version: 1 };
      setData((current) => ({ ...current, folders: [...current.folders, created] }));
      return created;
    },
    renameFolder: async (folder, name) => setData((current) => ({ ...current, folders: current.folders.map((item) => (item.id === folder.id ? { ...item, name, version: item.version + 1 } : item)) })),
    moveNote: async (note, folderId) => setData((current) => ({ ...current, notes: current.notes.map((item) => (item.id === note.id ? { ...item, folderId, version: item.version + 1 } : item)) })),
  };
}

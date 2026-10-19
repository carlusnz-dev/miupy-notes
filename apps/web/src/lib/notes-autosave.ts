import type { ApiError } from "./api-client";
import type { NoteOutput } from "./notes-api";
import { fromEditorText, toEditorText, type Eol } from "./notes-markdown";

// Limites iguais aos do contrato (apps/api/src/modules/notes/dto/input.ts).
export const MAX_TITLE = 200;
export const MAX_BODY = 100_000;
export const MAX_TAGS = 20;
export const MAX_TAG = 40;

/** `body` fica com \n no editor; o fim de linha original da nota volta na gravação (ver notes-markdown.ts). */
export type Draft = { title: string; body: string; tags: string[] };

export function toDraft(note: NoteOutput): Draft {
  return { title: note.title, body: toEditorText(note.body), tags: note.tags };
}

/** Só os campos alterados vão no PATCH; `null` quando não há o que salvar. */
export function changes(note: NoteOutput, draft: Draft, eol: Eol) {
  const title = draft.title.trim();
  const result: { title?: string; body?: string; tags?: string[] } = {};
  if (title !== note.title) result.title = title;
  if (draft.body !== toEditorText(note.body)) result.body = fromEditorText(draft.body, eol);
  if (draft.tags.join("\u0000") !== note.tags.join("\u0000")) result.tags = draft.tags;
  return Object.keys(result).length ? result : null;
}

export function validate(draft: Draft, eol: Eol, formatCount: (n: number) => string = String): string | null {
  const title = draft.title.trim();
  if (!title) return "Informe um título.";
  if (title.length > MAX_TITLE) return `O título passa de ${MAX_TITLE} caracteres.`;
  if (fromEditorText(draft.body, eol).length > MAX_BODY) return `O texto passa de ${formatCount(MAX_BODY)} caracteres.`;
  if (draft.tags.length > MAX_TAGS) return `Use no máximo ${MAX_TAGS} tags.`;
  if (draft.tags.some((tag) => tag.length > MAX_TAG)) return `Cada tag pode ter até ${MAX_TAG} caracteres.`;
  return null;
}

export type SaveResult =
  | { status: "busy" }
  | { status: "clean" }
  | { status: "invalid"; message: string }
  /** `stale`: a tela já mudou de nota; o resultado só serve ao cache, nunca ao estado da tela. */
  | { status: "saved"; note: NoteOutput; stale: boolean }
  | { status: "failed"; error: ApiError; stale: boolean };

type SaveArgs = {
  note: NoteOutput;
  draft: Draft;
  eol: Eol;
  /** Saindo da nota: um título em branco não impede gravar o resto (o título salvo é mantido). */
  leaving?: boolean;
  /** IDs com PATCH em andamento; uma nota por vez, mas notas diferentes não se bloqueiam. */
  inFlight: Set<string>;
  update: (id: string, input: { version: number; title?: string; body?: string; tags?: string[] }) => Promise<NoteOutput>;
  /** ID da nota aberta agora (lido de novo ao fim do PATCH). */
  openNoteId: () => string | undefined;
  formatCount?: (n: number) => string;
};

export async function saveNote({ note, draft, eol, leaving = false, inFlight, update, openNoteId, formatCount }: SaveArgs): Promise<SaveResult> {
  if (inFlight.has(note.id)) return { status: "busy" };
  const pending = leaving && !draft.title.trim() ? { ...draft, title: note.title } : draft;
  const message = validate(pending, eol, formatCount);
  if (message) return { status: "invalid", message };
  const patch = changes(note, pending, eol);
  if (!patch) return { status: "clean" };
  inFlight.add(note.id);
  try {
    const saved = await update(note.id, { version: note.version, ...patch });
    return { status: "saved", note: saved, stale: openNoteId() !== note.id };
  } catch (error) {
    return { status: "failed", error: error as ApiError, stale: openNoteId() !== note.id };
  } finally {
    inFlight.delete(note.id);
  }
}

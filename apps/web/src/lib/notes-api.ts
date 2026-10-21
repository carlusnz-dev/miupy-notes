import { noteMetadataListOutputSchema, noteSummaryOutputSchema, noteListOutputSchema, noteOutputSchema, type NoteListOutput, type NoteOutput as ContractNoteOutput } from "../../../api/src/modules/notes/contract";
import { apiClient, toApiError } from "./api-client";

export type { NoteMetadataOutput, NoteMetadataListOutput, NoteSummaryOutput, NoteListOutput } from "../../../api/src/modules/notes/contract";

export type NoteOutput = ContractNoteOutput;

export async function listNotes(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<NoteListOutput> {
  try {
    const response = await apiClient.get("/v1/notes", {
      params: { cursor: options.cursor, limit: options.limit },
      signal: options.signal,
    });
    return noteListOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function createNote(input: { title: string; body?: string; tags?: string[]; folderId?: string | null }): Promise<NoteOutput> {
  try {
    const response = await apiClient.post("/v1/notes", input);
    return noteOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function getNote(id: string, signal?: AbortSignal): Promise<NoteOutput> {
  try {
    const response = await apiClient.get(`/v1/notes/${encodeURIComponent(id)}`, { signal });
    return noteOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

/** `version` é a lida por último; a API responde 409 CONFLICT se outra gravação ocorreu. */
export async function updateNote(id: string, input: { version: number; title?: string; body?: string; tags?: string[]; folderId?: string | null }): Promise<NoteOutput> {
  try {
    const response = await apiClient.patch(`/v1/notes/${encodeURIComponent(id)}`, input);
    return noteOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    await apiClient.delete(`/v1/notes/${encodeURIComponent(id)}`);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function listNotesMetadata(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}) {
  try {
    const response = await apiClient.get("/v1/notes/metadata", { params: { cursor: options.cursor, limit: options.limit }, signal: options.signal });
    return noteMetadataListOutputSchema.parse(response.data);
  } catch (error) { throw toApiError(error); }
}

export async function getNotesSummary(days: 7 | 30 | 90, offsetMinutes: number, signal?: AbortSignal) {
  try {
    const response = await apiClient.get("/v1/notes/summary", { params: { days, offsetMinutes }, signal });
    return noteSummaryOutputSchema.parse(response.data);
  } catch (error) { throw toApiError(error); }
}

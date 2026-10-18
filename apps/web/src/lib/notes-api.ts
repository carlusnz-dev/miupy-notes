import { noteListOutputSchema, type NoteListOutput } from "../../../api/src/modules/notes/contract";
import { apiClient, toApiError } from "./api-client";

export type { NoteListOutput, NoteOutput } from "../../../api/src/modules/notes/contract";

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

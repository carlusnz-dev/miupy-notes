import { libraryItemOutputSchema, libraryListOutputSchema, type LibraryItemOutput, type CreateLibraryInput, type ListLibraryQuery } from "../../../api/src/modules/library/contract";
import { apiClient, toApiError } from "./api-client";

export type LibraryItem = LibraryItemOutput;
export type LibraryInput = CreateLibraryInput;
export type LibraryFilters = Pick<ListLibraryQuery, "kind" | "status" | "tag" | "q">;
export async function listLibrary(options: LibraryFilters & { cursor?: string; signal?: AbortSignal } = {}) {
  try {
    const { signal, ...params } = options;
    const response = await apiClient.get("/v1/library", { params: { ...params, limit: 24 }, signal });
    return libraryListOutputSchema.parse(response.data);
  } catch (error) { throw toApiError(error); }
}
export async function getLibraryItem(id: string, signal?: AbortSignal) {
  try { return libraryItemOutputSchema.parse((await apiClient.get(`/v1/library/${encodeURIComponent(id)}`, { signal })).data); }
  catch (error) { throw toApiError(error); }
}
export async function saveLibraryItem(input: LibraryInput, existing?: LibraryItem) {
  try {
    const response = existing
      ? await apiClient.patch(`/v1/library/${encodeURIComponent(existing.id)}`, { ...input, version: existing.version })
      : await apiClient.post("/v1/library", input);
    return libraryItemOutputSchema.parse(response.data);
  } catch (error) { throw toApiError(error); }
}
export async function deleteLibraryItem(id: string) {
  try { await apiClient.delete(`/v1/library/${encodeURIComponent(id)}`); }
  catch (error) { throw toApiError(error); }
}

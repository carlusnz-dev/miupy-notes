import { folderListOutputSchema, folderOutputSchema, MAX_FOLDER_NAME, type FolderListOutput, type FolderOutput } from "../../../api/src/modules/folders/contract";
import { apiClient, toApiError } from "./api-client";

export type { FolderListOutput, FolderOutput } from "../../../api/src/modules/folders/contract";
export { MAX_FOLDER_NAME };

export async function listFolders(signal?: AbortSignal): Promise<FolderListOutput> {
  try {
    const response = await apiClient.get("/v1/folders", { signal });
    return folderListOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function createFolder(input: { name: string; parentId?: string | null }): Promise<FolderOutput> {
  try {
    const response = await apiClient.post("/v1/folders", input);
    return folderOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

/** Só renomeia (a API não move pastas). `version` é a lida por último; 409 em conflito. */
export async function updateFolder(id: string, input: { version: number; name: string }): Promise<FolderOutput> {
  try {
    const response = await apiClient.patch(`/v1/folders/${encodeURIComponent(id)}`, input);
    return folderOutputSchema.parse(response.data);
  } catch (error) {
    throw toApiError(error);
  }
}

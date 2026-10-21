import { Folder } from "../domain/folder.js";
import { folderListOutputSchema, folderOutputSchema, type FolderListOutput, type FolderOutput } from "./output.js";

export class FolderDtoAdapter {
  static toOutput(folder: Folder): FolderOutput {
    return folderOutputSchema.parse({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      version: folder.version,
    });
  }

  static toListOutput(folders: Folder[]): FolderListOutput {
    return folderListOutputSchema.parse({ items: folders.map(FolderDtoAdapter.toOutput) });
  }
}

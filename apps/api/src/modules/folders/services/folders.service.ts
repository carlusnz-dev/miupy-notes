import { BaseService } from "../../../core/services/base.service.js";
import { Folder } from "../domain/folder.js";
import type { CreateFolderInput, UpdateFolderInput } from "../dto/input.js";
import { FoldersRepository } from "../repository/folders.repository.js";

export abstract class FoldersService extends BaseService<Folder, FoldersRepository> {
  abstract create(ownerId: string, input: CreateFolderInput): Promise<Folder>;
  abstract findById(ownerId: string, id: string): Promise<Folder>;
  abstract exists(ownerId: string, id: string): Promise<boolean>;
  abstract list(ownerId: string): Promise<Folder[]>;
  abstract update(ownerId: string, id: string, input: UpdateFolderInput): Promise<Folder>;
}

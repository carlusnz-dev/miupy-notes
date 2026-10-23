import { BaseService } from "../../../core/services/base.service.js";
import type { LibraryItem } from "../domain/library-item.js";
import type { CreateLibraryInput, ListLibraryQuery, UpdateLibraryInput } from "../dto/input.js";
import { LibraryRepository, type LibraryPage } from "../repository/library.repository.js";

export abstract class LibraryService extends BaseService<LibraryItem, LibraryRepository> {
  abstract create(ownerId: string, input: CreateLibraryInput): Promise<LibraryItem>;
  abstract findById(ownerId: string, id: string): Promise<LibraryItem>;
  abstract list(ownerId: string, query: ListLibraryQuery): Promise<LibraryPage>;
  abstract update(ownerId: string, id: string, input: UpdateLibraryInput): Promise<LibraryItem>;
  abstract delete(ownerId: string, id: string): Promise<void>;
}

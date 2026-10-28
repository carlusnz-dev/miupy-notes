import { BaseRepository } from "../../../core/repository/base.repository.js";
import type { LibraryItem } from "../domain/library-item.js";
import type { ListLibraryQuery } from "../dto/input.js";

export type LibraryPage = { items: LibraryItem[]; nextCursor: string | null };
export abstract class LibraryRepository extends BaseRepository<LibraryItem> {
  abstract list(ownerId: string, query: ListLibraryQuery): Promise<LibraryPage>;
  abstract update(item: LibraryItem, expectedVersion: number): Promise<LibraryItem | null>;
  abstract delete(ownerId: string, id: string): Promise<boolean>;
}

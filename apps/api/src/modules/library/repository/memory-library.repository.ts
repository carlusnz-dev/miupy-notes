import type { LibraryItem } from "../domain/library-item.js";
import type { ListLibraryQuery } from "../dto/input.js";
import { LibraryRepository, type LibraryPage } from "./library.repository.js";
import { decodeCursor, encodeCursor, matches } from "./pagination.js";

export class MemoryLibraryRepository extends LibraryRepository {
  private readonly items = new Map<string, LibraryItem>();
  async create(item: LibraryItem) { this.items.set(`${item.ownerId}:${item.id}`, item); return item; }
  async findById(ownerId: string, id: string) { return this.items.get(`${ownerId}:${id}`) ?? null; }
  async list(ownerId: string, query: ListLibraryQuery): Promise<LibraryPage> {
    const after = query.cursor ? decodeCursor(query.cursor) : "";
    const remaining = [...this.items.values()].filter(item => item.ownerId === ownerId && item.id > after).sort((a, b) => a.id.localeCompare(b.id));
    const evaluated = remaining.slice(0, query.limit);
    return { items: evaluated.filter(item => matches(item, query)), nextCursor: remaining.length > query.limit ? encodeCursor(evaluated.at(-1)!.id) : null };
  }
  async update(item: LibraryItem, expectedVersion: number) {
    const key = `${item.ownerId}:${item.id}`;
    if (this.items.get(key)?.version !== expectedVersion) return null;
    this.items.set(key, item); return item;
  }
  async delete(ownerId: string, id: string) { return this.items.delete(`${ownerId}:${id}`); }
}

import { Note } from "../domain/note.js";
import { NotesRepository, type NotePage } from "./notes.repository.js";

/** Implementação em memória para testes; ordena por ID como a chave de ordenação do DynamoDB. */
export class MemoryNotesRepository extends NotesRepository {
  private readonly items = new Map<string, Note>();

  async create(note: Note): Promise<Note> {
    this.items.set(`${note.ownerId}:${note.id}`, note);
    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    return this.items.get(`${ownerId}:${id}`) ?? null;
  }

  async list(ownerId: string, limit: number, cursor?: string): Promise<NotePage> {
    const owned = [...this.items.values()].filter((note) => note.ownerId === ownerId).sort((a, b) => a.id.localeCompare(b.id));
    const after = cursor ? Buffer.from(cursor, "base64url").toString("utf8") : "";
    const remaining = owned.filter((note) => note.id > after);
    const items = remaining.slice(0, limit);
    return { items, nextCursor: remaining.length > limit ? Buffer.from(items.at(-1)!.id).toString("base64url") : null };
  }

  async update(note: Note, expectedVersion: number): Promise<Note | null> {
    const key = `${note.ownerId}:${note.id}`;
    if (this.items.get(key)?.version !== expectedVersion) return null;
    this.items.set(key, note);
    return note;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    return this.items.delete(`${ownerId}:${id}`);
  }
}

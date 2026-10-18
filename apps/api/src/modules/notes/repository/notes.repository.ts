import { BaseRepository } from "../../../core/repository/base.repository.js";
import { Note } from "../domain/note.js";

export type NotePage = { readonly items: Note[]; readonly nextCursor: string | null };

export abstract class NotesRepository extends BaseRepository<Note> {
  abstract list(ownerId: string, limit: number, cursor?: string): Promise<NotePage>;
  /** Grava `note` somente se a versão persistida ainda for `expectedVersion`; retorna null em conflito. */
  abstract update(note: Note, expectedVersion: number): Promise<Note | null>;
  /** Retorna false quando a nota não existe para o proprietário. */
  abstract delete(ownerId: string, id: string): Promise<boolean>;
}

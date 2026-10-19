import { BaseService } from "../../../core/services/base.service.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput, ListNotesQuery, UpdateNoteInput } from "../dto/input.js";
import { NotesRepository, type NotePage } from "../repository/notes.repository.js";

export abstract class NotesService extends BaseService<Note, NotesRepository> {
  abstract create(ownerId: string, input: CreateNoteInput): Promise<Note>;
  abstract findById(ownerId: string, id: string): Promise<Note>;
  abstract list(ownerId: string, query: ListNotesQuery): Promise<NotePage>;
  abstract update(ownerId: string, id: string, input: UpdateNoteInput): Promise<Note>;
  abstract delete(ownerId: string, id: string): Promise<void>;
}

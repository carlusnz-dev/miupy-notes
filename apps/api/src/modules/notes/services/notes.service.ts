import { BaseService } from "../../../core/services/base.service.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput } from "../dto/input.js";
import { NotesRepository } from "../repository/notes.repository.js";

export abstract class NotesService extends BaseService<Note, NotesRepository> {
  abstract create(ownerId: string, input: CreateNoteInput): Promise<Note>;
  abstract findById(ownerId: string, id: string): Promise<Note>;
}

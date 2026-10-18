import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput } from "../dto/input.js";
import { NotesRepository } from "../repository/notes.repository.js";
import { NotesService } from "./notes.service.js";

export class NotesServiceImpl extends NotesService {
  constructor(repository: NotesRepository) { super(repository); }

  create(ownerId: string, input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    return this.repository.create(new Note(randomUUID(), ownerId, input.title, input.body, input.tags, now, now, 1));
  }

  async findById(ownerId: string, id: string): Promise<Note> {
    const note = await this.repository.findById(ownerId, id);
    if (!note) throw new AppError(404, "NOT_FOUND", "Nota não encontrada.");
    return note;
  }
}

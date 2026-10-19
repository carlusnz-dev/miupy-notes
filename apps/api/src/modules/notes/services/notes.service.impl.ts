import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput, ListNotesQuery, UpdateNoteInput } from "../dto/input.js";
import { NotesRepository, type NotePage } from "../repository/notes.repository.js";
import { NotesService } from "./notes.service.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Nota não encontrada.");
const conflict = () => new AppError(409, "CONFLICT", "A nota foi alterada por outra operação. Recarregue e tente de novo.");

export class NotesServiceImpl extends NotesService {
  constructor(repository: NotesRepository) { super(repository); }

  create(ownerId: string, input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    return this.repository.create(new Note(randomUUID(), ownerId, input.title, input.body, input.tags, now, now, 1));
  }

  async findById(ownerId: string, id: string): Promise<Note> {
    const note = await this.repository.findById(ownerId, id);
    if (!note) throw notFound();
    return note;
  }

  list(ownerId: string, query: ListNotesQuery): Promise<NotePage> {
    return this.repository.list(ownerId, query.limit, query.cursor);
  }

  async update(ownerId: string, id: string, input: UpdateNoteInput): Promise<Note> {
    const current = await this.findById(ownerId, id);
    if (current.version !== input.version) throw conflict();
    const next = new Note(
      id, ownerId,
      input.title ?? current.title, input.body ?? current.body, input.tags ?? current.tags,
      current.createdAt, new Date().toISOString(), current.version + 1,
    );
    // A condição no repositório cobre gravações concorrentes entre a leitura e a escrita.
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return saved;
  }

  async delete(ownerId: string, id: string): Promise<void> {
    if (!(await this.repository.delete(ownerId, id))) throw notFound();
  }
}

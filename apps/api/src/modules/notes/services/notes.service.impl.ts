import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput, ListNotesQuery, NoteSummaryQuery, UpdateNoteInput } from "../dto/input.js";
import { NotesRepository, type NotePage } from "../repository/notes.repository.js";
import type { FolderDirectory } from "./folder-directory.js";
import { NotesService } from "./notes.service.js";
import { summarizeNotes } from "./notes-summary.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Nota não encontrada.");
const invalidFolder = () => new AppError(400, "VALIDATION_ERROR", "Pasta inválida.");
const conflict = () => new AppError(409, "CONFLICT", "A nota foi alterada por outra operação. Recarregue e tente de novo.");

export class NotesServiceImpl extends NotesService {
  constructor(repository: NotesRepository, private readonly folders: FolderDirectory) { super(repository); }

  async create(ownerId: string, input: CreateNoteInput): Promise<Note> {
    await this.assertFolder(ownerId, input.folderId);
    const now = new Date().toISOString();
    return this.repository.create(new Note(randomUUID(), ownerId, input.title, input.body, input.tags, input.folderId, now, now, 1));
  }

  async findById(ownerId: string, id: string): Promise<Note> {
    const note = await this.repository.findById(ownerId, id);
    if (!note) throw notFound();
    return note;
  }

  list(ownerId: string, query: ListNotesQuery): Promise<NotePage> {
    return this.repository.list(ownerId, query.limit, query.cursor);
  }

  listMetadata(ownerId: string, query: ListNotesQuery) {
    return this.repository.listMetadata(ownerId, query.limit, query.cursor);
  }

  summary(ownerId: string, query: NoteSummaryQuery) {
    return summarizeNotes(this.repository, ownerId, query);
  }

  async update(ownerId: string, id: string, input: UpdateNoteInput): Promise<Note> {
    const current = await this.findById(ownerId, id);
    if (current.version !== input.version) throw conflict();
    const folderId = input.folderId === undefined ? current.folderId : input.folderId;
    if (folderId !== current.folderId) await this.assertFolder(ownerId, folderId);
    const next = new Note(
      id, ownerId,
      input.title ?? current.title, input.body ?? current.body, input.tags ?? current.tags, folderId,
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

  /** Pasta ausente ou de outro proprietário respondem igual, sem revelar que existe. */
  private async assertFolder(ownerId: string, folderId: string | null): Promise<void> {
    if (folderId !== null && !(await this.folders.exists(ownerId, folderId))) throw invalidFolder();
  }
}

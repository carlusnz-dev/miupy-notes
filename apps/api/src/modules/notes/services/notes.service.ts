import { BaseService } from "../../../core/services/base.service.js";
import { Note } from "../domain/note.js";
import type { CreateNoteInput, ListNotesQuery, NoteSummaryQuery, UpdateNoteInput } from "../dto/input.js";
import { NotesRepository, type NoteMetadataPage, type NotePage } from "../repository/notes.repository.js";

import type { NoteSummaryOutput } from "../dto/output.js";

export abstract class NotesService extends BaseService<Note, NotesRepository> {
  abstract create(ownerId: string, input: CreateNoteInput): Promise<Note>;
  abstract findById(ownerId: string, id: string): Promise<Note>;
  abstract list(ownerId: string, query: ListNotesQuery): Promise<NotePage>;
  abstract listMetadata(ownerId: string, query: ListNotesQuery): Promise<NoteMetadataPage>;
  abstract summary(ownerId: string, query: NoteSummaryQuery): Promise<NoteSummaryOutput>;
  abstract update(ownerId: string, id: string, input: UpdateNoteInput): Promise<Note>;
  abstract delete(ownerId: string, id: string): Promise<void>;
}

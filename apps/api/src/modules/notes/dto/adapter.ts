import { Note } from "../domain/note.js";
import type { NotePage } from "../repository/notes.repository.js";
import { noteListOutputSchema, noteOutputSchema, type NoteListOutput, type NoteOutput } from "./output.js";

export class NoteDtoAdapter {
  static toOutput(note: Note): NoteOutput {
    return noteOutputSchema.parse({
      id: note.id,
      title: note.title,
      body: note.body,
      tags: note.tags,
      folderId: note.folderId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      version: note.version,
    });
  }

  static toListOutput(page: NotePage): NoteListOutput {
    return noteListOutputSchema.parse({ items: page.items.map(NoteDtoAdapter.toOutput), nextCursor: page.nextCursor });
  }
}

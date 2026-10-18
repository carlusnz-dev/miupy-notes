import { Note } from "../domain/note.js";
import { noteOutputSchema, type NoteOutput } from "./output.js";

export class NoteDtoAdapter {
  static toOutput(note: Note): NoteOutput {
    return noteOutputSchema.parse({
      id: note.id,
      title: note.title,
      body: note.body,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      version: note.version,
    });
  }
}

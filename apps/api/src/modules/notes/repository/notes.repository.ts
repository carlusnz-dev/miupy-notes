import { BaseRepository } from "../../../core/repository/base.repository.js";
import { Note } from "../domain/note.js";

export abstract class NotesRepository extends BaseRepository<Note> {}

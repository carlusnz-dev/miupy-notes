import assert from "node:assert/strict";
import { test } from "node:test";
import { NoteDtoAdapter } from "../dto/adapter.js";
import { Note } from "../domain/note.js";
import { NotesRepository } from "../repository/notes.repository.js";
import { NotesServiceImpl } from "./notes.service.impl.js";

class MemoryNotesRepository extends NotesRepository {
  private readonly items = new Map<string, Note>();

  async create(note: Note): Promise<Note> {
    this.items.set(`${note.ownerId}:${note.id}`, note);
    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    return this.items.get(`${ownerId}:${id}`) ?? null;
  }
}

test("service mantém isolamento por proprietário e DTO não expõe ownerId", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository());
  const created = await service.create("alice", { title: "Primeira nota", body: "texto", tags: [] });
  assert.equal((await service.findById("alice", created.id)).id, created.id);
  await assert.rejects(service.findById("bob", created.id), { code: "NOT_FOUND" });
  assert.equal("ownerId" in NoteDtoAdapter.toOutput(created), false);
});

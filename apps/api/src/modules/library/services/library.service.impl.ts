import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { LibraryItem } from "../domain/library-item.js";
import { validDates, type CreateLibraryInput, type ListLibraryQuery, type UpdateLibraryInput } from "../dto/input.js";
import { LibraryRepository } from "../repository/library.repository.js";
import { LibraryService } from "./library.service.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Obra não encontrada.");
const conflict = () => new AppError(409, "CONFLICT", "Esta obra foi alterada por outra operação. Feche e abra novamente para recarregar.");
export class LibraryServiceImpl extends LibraryService {
  constructor(repository: LibraryRepository) { super(repository); }
  async create(ownerId: string, input: CreateLibraryInput) {
    const now = new Date().toISOString();
    return this.repository.create(new LibraryItem(ownerId, { ...input, id: randomUUID(), createdAt: now, updatedAt: now, version: 1 }));
  }
  async findById(ownerId: string, id: string) {
    const item = await this.repository.findById(ownerId, id);
    if (!item) throw notFound();
    return item;
  }
  list(ownerId: string, query: ListLibraryQuery) { return this.repository.list(ownerId, query); }
  async update(ownerId: string, id: string, input: UpdateLibraryInput) {
    const current = await this.findById(ownerId, id);
    if (current.version !== input.version) throw conflict();
    const next = new LibraryItem(ownerId, { ...current, ...input, version: current.version + 1, updatedAt: new Date().toISOString() });
    if (!validDates(next)) throw new AppError(400, "VALIDATION_ERROR", "A data de fim deve ser igual ou posterior ao início.");
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return saved;
  }
  async delete(ownerId: string, id: string) { if (!await this.repository.delete(ownerId, id)) throw notFound(); }
}

import { Folder } from "../domain/folder.js";
import { FoldersRepository } from "./folders.repository.js";

/** Implementação em memória para testes. */
export class MemoryFoldersRepository extends FoldersRepository {
  private readonly items = new Map<string, Folder>();

  async create(folder: Folder): Promise<Folder> {
    this.items.set(`${folder.ownerId}:${folder.id}`, folder);
    return folder;
  }

  async findById(ownerId: string, id: string): Promise<Folder | null> {
    return this.items.get(`${ownerId}:${id}`) ?? null;
  }

  async listAll(ownerId: string): Promise<Folder[]> {
    return [...this.items.values()].filter((folder) => folder.ownerId === ownerId);
  }

  async update(folder: Folder, expectedVersion: number): Promise<Folder | null> {
    const key = `${folder.ownerId}:${folder.id}`;
    if (this.items.get(key)?.version !== expectedVersion) return null;
    this.items.set(key, folder);
    return folder;
  }

}

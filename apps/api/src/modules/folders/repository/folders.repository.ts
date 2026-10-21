import { BaseRepository } from "../../../core/repository/base.repository.js";
import { Folder } from "../domain/folder.js";

export abstract class FoldersRepository extends BaseRepository<Folder> {
  /** Todas as pastas do proprietário; o serviço limita a quantidade na criação. */
  abstract listAll(ownerId: string): Promise<Folder[]>;
  /** Grava `folder` somente se a versão persistida ainda for `expectedVersion`; retorna null em conflito. */
  abstract update(folder: Folder, expectedVersion: number): Promise<Folder | null>;
}

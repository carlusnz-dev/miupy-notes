import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { Folder } from "../domain/folder.js";
import type { CreateFolderInput, UpdateFolderInput } from "../dto/input.js";
import { FoldersRepository } from "../repository/folders.repository.js";
import { FoldersService } from "./folders.service.js";

// Limites de uso pessoal: a lista de pastas vem inteira numa resposta e a árvore é desenhada no cliente.
export const MAX_FOLDERS = 500;
export const MAX_DEPTH = 8;

// Pastas são imutáveis quanto ao pai e nunca excluídas: sem mover/excluir não há ciclo, pai removido nem pasta
// órfã por corrida, e a profundidade checada na criação vale para sempre.

const notFound = () => new AppError(404, "NOT_FOUND", "Pasta não encontrada.");
const conflict = () => new AppError(409, "CONFLICT", "A pasta foi alterada por outra operação. Recarregue e tente de novo.");
const invalid = (message: string) => new AppError(400, "VALIDATION_ERROR", message);

export class FoldersServiceImpl extends FoldersService {
  constructor(repository: FoldersRepository) { super(repository); }

  async create(ownerId: string, input: CreateFolderInput): Promise<Folder> {
    const all = await this.repository.listAll(ownerId);
    if (all.length >= MAX_FOLDERS) throw invalid(`Limite de ${MAX_FOLDERS} pastas atingido.`);
    const byId = new Map(all.map((folder) => [folder.id, folder]));
    if (input.parentId !== null) {
      if (!byId.has(input.parentId)) throw invalid("Pasta pai inválida.");
      if (depthOf(byId, input.parentId) + 1 > MAX_DEPTH) throw invalid(`Use no máximo ${MAX_DEPTH} níveis de pastas.`);
    }
    const now = new Date().toISOString();
    return this.repository.create(new Folder(randomUUID(), ownerId, input.name, input.parentId, now, now, 1));
  }

  async findById(ownerId: string, id: string): Promise<Folder> {
    const folder = await this.repository.findById(ownerId, id);
    if (!folder) throw notFound();
    return folder;
  }

  async exists(ownerId: string, id: string): Promise<boolean> {
    return (await this.repository.findById(ownerId, id)) !== null;
  }

  async list(ownerId: string): Promise<Folder[]> {
    return (await this.repository.listAll(ownerId)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  }

  /** Só renomeia. Mover e excluir pastas ficam fora desta etapa (ver docs/arquitetura/api.md). */
  async update(ownerId: string, id: string, input: UpdateFolderInput): Promise<Folder> {
    const current = await this.findById(ownerId, id);
    if (current.version !== input.version) throw conflict();
    const next = new Folder(id, ownerId, input.name, current.parentId, current.createdAt, new Date().toISOString(), current.version + 1);
    // A condição no repositório cobre gravações concorrentes entre a leitura e a escrita.
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return saved;
  }
}

/** Nível da pasta: 1 para uma pasta na raiz. */
function depthOf(byId: Map<string, Folder>, id: string): number {
  let depth = 0;
  for (let cursor: string | null = id; cursor !== null && depth <= MAX_FOLDERS; cursor = byId.get(cursor)?.parentId ?? null) depth++;
  return depth;
}

/** Porta para validar a pasta de uma nota sem importar o módulo de pastas; a composição a liga. */
export interface FolderDirectory {
  exists(ownerId: string, folderId: string): Promise<boolean>;
}

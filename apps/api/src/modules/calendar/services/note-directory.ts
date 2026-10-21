/** Porta para validar a relação com uma nota sem importar o módulo de notas; a composição a liga. */
export interface NoteDirectory {
  exists(ownerId: string, noteId: string): Promise<boolean>;
}

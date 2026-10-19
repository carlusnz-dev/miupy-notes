import { z } from "zod";

export const MAX_FOLDER_NAME = 100;

const name = z.string().trim().min(1).max(MAX_FOLDER_NAME);
const parentId = z.uuid().nullable();

export const createFolderInputSchema = z.strictObject({
  name,
  parentId: parentId.default(null),
});

/** Só renomeia: `parentId` é rejeitado (campo desconhecido), pois mover pastas não é suportado. */
export const updateFolderInputSchema = z.strictObject({
  name,
  version: z.int().positive(),
});

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;

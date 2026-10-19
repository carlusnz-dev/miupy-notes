import { z } from "zod";

export const folderOutputSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export const folderListOutputSchema = z.object({ items: z.array(folderOutputSchema) });

export type FolderOutput = z.infer<typeof folderOutputSchema>;
export type FolderListOutput = z.infer<typeof folderListOutputSchema>;

import { z } from "zod";

const title = z.string().trim().min(1).max(200);
const body = z.string().max(100_000);
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const folderId = z.uuid().nullable();

export const createNoteInputSchema = z.strictObject({
  title,
  body: body.default(""),
  tags: tags.default([]),
  folderId: folderId.default(null),
});

export const updateNoteInputSchema = z.strictObject({
  title: title.optional(),
  body: body.optional(),
  tags: tags.optional(),
  // `null` move a nota para a raiz; omitido, mantém a pasta.
  folderId: folderId.optional(),
  version: z.int().positive(),
}).refine((input) => input.title !== undefined || input.body !== undefined || input.tags !== undefined || input.folderId !== undefined);

export const listNotesQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

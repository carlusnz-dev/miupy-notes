import { z } from "zod";

export const noteOutputSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  folderId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export const noteListOutputSchema = z.object({
  items: z.array(noteOutputSchema),
  nextCursor: z.string().nullable(),
});

export type NoteOutput = z.infer<typeof noteOutputSchema>;
export type NoteListOutput = z.infer<typeof noteListOutputSchema>;

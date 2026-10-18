import { z } from "zod";

export const noteOutputSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export type NoteOutput = z.infer<typeof noteOutputSchema>;

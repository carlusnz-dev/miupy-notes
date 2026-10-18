import { z } from "zod";

export const createNoteInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

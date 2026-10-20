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

export const noteMetadataOutputSchema = noteOutputSchema.omit({ body: true });
export const noteMetadataListOutputSchema = z.object({
  items: z.array(noteMetadataOutputSchema),
  nextCursor: z.string().nullable(),
});
export const noteSummaryOutputSchema = z.object({
  total: z.int().nonnegative(), words: z.int().nonnegative(),
  characters: z.int().nonnegative(), averageWords: z.int().nonnegative(),
  first: z.iso.datetime().nullable(), last: z.iso.datetime().nullable(),
  windowDays: z.int().positive(), createdInWindow: z.int().nonnegative(),
  createdPerDay: z.array(z.object({ date: z.string(), count: z.int().nonnegative() })),
  tags: z.array(z.object({ tag: z.string(), count: z.int().nonnegative() })),
  topNotes: z.array(z.object({ title: z.string(), words: z.int().nonnegative() })),
});
export type NoteMetadataOutput = z.infer<typeof noteMetadataOutputSchema>;
export type NoteMetadataListOutput = z.infer<typeof noteMetadataListOutputSchema>;
export type NoteSummaryOutput = z.infer<typeof noteSummaryOutputSchema>;

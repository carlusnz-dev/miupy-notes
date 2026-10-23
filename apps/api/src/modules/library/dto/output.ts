import { z } from "zod";
import { libraryFields } from "./input.js";

export const libraryItemOutputSchema = z.object({
  ...libraryFields, id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.int().positive(),
});
export const libraryListOutputSchema = z.object({ items: z.array(libraryItemOutputSchema), nextCursor: z.string().nullable() });
export type LibraryItemOutput = z.infer<typeof libraryItemOutputSchema>;
export type LibraryListOutput = z.infer<typeof libraryListOutputSchema>;

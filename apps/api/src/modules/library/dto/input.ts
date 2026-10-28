import { z } from "zod";

export const libraryFields = {
  kind: z.enum(["book", "film", "music"]),
  title: z.string().trim().min(1).max(200),
  creator: z.string().trim().max(200),
  year: z.int().min(1).max(9999).nullable(),
  status: z.enum(["wanted", "in_progress", "completed", "abandoned"]),
  rating: z.number().min(0).max(5).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  startedOn: z.iso.date().nullable(),
  finishedOn: z.iso.date().nullable(),
  comment: z.string().trim().max(1000),
  externalUrl: z.url({ protocol: /^https?$/ }).max(2048).nullable(),
  coverUrl: z.url({ protocol: /^https?$/ }).max(2048).nullable(),
};

export function validDates(input: { startedOn?: string | null; finishedOn?: string | null }) {
  return !input.startedOn || !input.finishedOn || input.startedOn <= input.finishedOn;
}

export const createLibraryInputSchema = z.strictObject({
  ...libraryFields,
  creator: libraryFields.creator.default(""), year: libraryFields.year.default(null),
  status: libraryFields.status.default("wanted"), rating: libraryFields.rating.default(null),
  tags: libraryFields.tags.default([]), startedOn: libraryFields.startedOn.default(null),
  finishedOn: libraryFields.finishedOn.default(null), comment: libraryFields.comment.default(""),
  externalUrl: libraryFields.externalUrl.default(null), coverUrl: libraryFields.coverUrl.default(null),
}).refine(validDates, { message: "A data de fim deve ser igual ou posterior ao início." });

export const updateLibraryInputSchema = z.strictObject({
  ...z.strictObject(libraryFields).partial().shape,
  version: z.int().positive(),
}).refine(input => Object.keys(input).some(key => key !== "version"))
  .refine(validDates, { message: "A data de fim deve ser igual ou posterior ao início." });

export const listLibraryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  kind: libraryFields.kind.optional(), status: libraryFields.status.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type CreateLibraryInput = z.infer<typeof createLibraryInputSchema>;
export type UpdateLibraryInput = z.infer<typeof updateLibraryInputSchema>;
export type ListLibraryQuery = z.infer<typeof listLibraryQuerySchema>;

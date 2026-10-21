import { z } from "zod";

const title = z.string().trim().min(1).max(200);
const description = z.string().max(8_000);
const location = z.string().trim().max(300);
const link = z.strictObject({ kind: z.enum(["note", "event"]), id: z.uuid() });
const links = z.array(link).max(20);
// Datas e instantes chegam como texto e são validados/normalizados por `normalizeTimes`.
const timeText = z.string().min(10).max(40);
const timeZone = z.string().min(1).max(64).nullable();

export const createEventInputSchema = z.strictObject({
  /** UUID gerado pelo cliente: repetir o mesmo envio não cria outro evento (idempotência da outbox). */
  id: z.uuid().optional(),
  title,
  description: description.default(""),
  location: location.default(""),
  allDay: z.boolean().default(false),
  start: timeText,
  end: timeText,
  timeZone: timeZone.optional(),
  links: links.default([]),
});

export const updateEventInputSchema = z.strictObject({
  version: z.int().positive(),
  title: title.optional(),
  description: description.optional(),
  location: location.optional(),
  allDay: z.boolean().optional(),
  start: timeText.optional(),
  end: timeText.optional(),
  timeZone: timeZone.optional(),
  links: links.optional(),
}).refine((input) => Object.keys(input).some((key) => key !== "version"));

export const listEventsQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const deleteEventQuerySchema = z.strictObject({ version: z.coerce.number().int().positive() });

export const authorizeGoogleInputSchema = z.strictObject({
  mode: z.enum(["mirror", "reflect"]),
  redirectUri: z.url().max(300),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});

export const connectGoogleInputSchema = z.strictObject({
  state: z.string().min(16).max(128),
  code: z.string().min(1).max(2048),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirectUri: z.url().max(300),
});

export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type AuthorizeGoogleInput = z.infer<typeof authorizeGoogleInputSchema>;
export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>;

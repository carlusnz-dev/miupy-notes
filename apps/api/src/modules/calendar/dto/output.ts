import { z } from "zod";

const link = z.object({ kind: z.enum(["note", "event"]), id: z.uuid() });

export const calendarEventOutputSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  timeZone: z.string().nullable(),
  links: z.array(link),
  source: z.enum(["local", "google"]),
  /** Espelhos do Google são somente leitura no app. */
  readOnly: z.boolean(),
  external: z.object({ provider: z.literal("google"), calendarId: z.string(), syncedAt: z.iso.datetime() }).nullable(),
  /** `inSync` é falso quando o evento local mudou depois do último envio ao Google; `state: "deleted_remote"` = a cópia foi excluída no Google. */
  reflection: z.object({ reflectedAt: z.iso.datetime(), reflectedVersion: z.int().positive(), inSync: z.boolean(), state: z.enum(["linked", "deleted_remote"]) }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export const calendarEventListOutputSchema = z.object({
  items: z.array(calendarEventOutputSchema),
  nextCursor: z.string().nullable(),
});

export const googleStatusOutputSchema = z.object({
  /** `not_configured`: este servidor não tem cliente OAuth nem cofre de credenciais; nenhuma conexão real é possível. */
  state: z.enum(["not_configured", "not_connected", "connected", "needs_reauth"]),
  mode: z.enum(["mirror", "reflect"]).nullable(),
  scopes: z.array(z.string()),
  calendarId: z.string().nullable(),
  connectedAt: z.iso.datetime().nullable(),
  lastSyncAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  hasSyncCursor: z.boolean(),
});

export const googleAuthorizationOutputSchema = z.object({ authorizationUrl: z.url(), state: z.string(), expiresAt: z.iso.datetime() });

export const googleSyncOutputSchema = z.object({
  kind: z.enum(["full", "incremental"]),
  pages: z.int().nonnegative(),
  upserted: z.int().nonnegative(),
  deleted: z.int().nonnegative(),
  /** O Google invalidou o cursor (410): o espelho foi refeito do zero. */
  resynced: z.boolean(),
  lastSyncAt: z.iso.datetime(),
});

export type CalendarEventOutput = z.infer<typeof calendarEventOutputSchema>;
export type CalendarEventListOutput = z.infer<typeof calendarEventListOutputSchema>;
export type GoogleStatusOutput = z.infer<typeof googleStatusOutputSchema>;
export type GoogleAuthorizationOutput = z.infer<typeof googleAuthorizationOutputSchema>;
export type GoogleSyncOutput = z.infer<typeof googleSyncOutputSchema>;

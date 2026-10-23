import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import type { LibraryItem } from "../domain/library-item.js";
import type { ListLibraryQuery } from "../dto/input.js";

export function encodeCursor(id: string): string { return Buffer.from(JSON.stringify({ id })).toString("base64url"); }
export function decodeCursor(cursor: string): string {
  try { return z.strictObject({ id: z.uuid() }).parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).id; }
  catch { throw new AppError(400, "VALIDATION_ERROR", "Cursor inválido."); }
}
export function matches(item: LibraryItem, query: ListLibraryQuery): boolean {
  return (!query.kind || item.kind === query.kind) && (!query.status || item.status === query.status)
    && (!query.tag || item.tags.includes(query.tag))
    && (!query.q || item.title.toLocaleLowerCase("pt-BR").includes(query.q.toLocaleLowerCase("pt-BR")));
}

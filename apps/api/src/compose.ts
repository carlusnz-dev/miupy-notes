import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AppError } from "./core/domain/app-error.js";
import { createCalendarModule, type GoogleIntegrationDeps } from "./modules/calendar/index.js";
import { createFinanceModule } from "./modules/finance/index.js";
import { createFoldersModule } from "./modules/folders/index.js";
import { createHabitsModule, type HabitsOptions } from "./modules/habits/index.js";
import { createLibraryModule } from "./modules/library/index.js";
import { createNotesModule } from "./modules/notes/index.js";

/**
 * Liga notas e pastas, que não se importam: notas validam a pasta pela porta `FolderDirectory`, que o
 * serviço de pastas satisfaz. A agenda valida relações com notas pela porta `NoteDirectory`, satisfeita pelo serviço de notas.
 * Notas, pastas, finanças, agenda e biblioteca dividem a tabela (`NOTE#`, `FOLDER#`, `FINANCE#`, `EVENT#`, `CALENDAR#`, `LIBRARY#` e `HABIT#`/`HLOG#`/`HXP#`).
 * O Google Calendar fica desligado ("não configurado") até haver cliente OAuth e cofre de credenciais protegidos.
 */
export function createDataModules(client: DynamoDBDocumentClient, tableName: string, google: GoogleIntegrationDeps | null = null, habitsOptions: HabitsOptions = {}) {
  const folders = createFoldersModule(client, tableName);
  const notes = createNotesModule(client, tableName, folders.service);
  const finance = createFinanceModule(client, tableName);
  const calendar = createCalendarModule(client, tableName, {
    exists: (ownerId, noteId) => notes.service.findById(ownerId, noteId).then(() => true, (error: unknown) => (error instanceof AppError && error.status === 404 ? false : Promise.reject(error))),
  }, google);
  const library = createLibraryModule(client, tableName);
  const habits = createHabitsModule(client, tableName, habitsOptions);
  return { notes, folders, finance, calendar, library, habits };
}

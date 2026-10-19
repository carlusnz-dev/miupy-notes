import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createFinanceModule } from "./modules/finance/index.js";
import { createFoldersModule } from "./modules/folders/index.js";
import { createNotesModule } from "./modules/notes/index.js";

/**
 * Liga notas e pastas, que não se importam: notas validam a pasta pela porta `FolderDirectory`, que o
 * serviço de pastas satisfaz. Notas, pastas e finanças dividem a tabela (`NOTE#`, `FOLDER#` e `FINANCE#`).
 */
export function createDataModules(client: DynamoDBDocumentClient, tableName: string) {
  const folders = createFoldersModule(client, tableName);
  const notes = createNotesModule(client, tableName, folders.service);
  const finance = createFinanceModule(client, tableName);
  return { notes, folders, finance };
}

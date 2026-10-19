import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createFoldersModule } from "./modules/folders/index.js";
import { createNotesModule } from "./modules/notes/index.js";

/**
 * Liga notas e pastas, que não se importam: notas validam a pasta pela porta `FolderDirectory`, que o
 * serviço de pastas satisfaz. Notas e pastas dividem a tabela (`NOTE#` e `FOLDER#`).
 */
export function createDataModules(client: DynamoDBDocumentClient, tableName: string) {
  const folders = createFoldersModule(client, tableName);
  const notes = createNotesModule(client, tableName, folders.service);
  return { notes, folders };
}

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NotesController } from "./controllers/notes.controller.js";
import { DynamoNotesRepository } from "./repository/dynamo-notes.repository.js";
import { createNotesRouter } from "./routes/notes.routes.js";
import { NotesServiceImpl } from "./services/notes.service.impl.js";

export function createNotesModule(client: DynamoDBDocumentClient, tableName: string) {
  const repository = new DynamoNotesRepository(client, tableName);
  const service = new NotesServiceImpl(repository);
  const controller = new NotesController(service);
  return { service, router: createNotesRouter(controller) };
}

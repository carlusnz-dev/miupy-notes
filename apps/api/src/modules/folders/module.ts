import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { FoldersController } from "./controllers/folders.controller.js";
import { DynamoFoldersRepository } from "./repository/dynamo-folders.repository.js";
import { createFoldersRouter } from "./routes/folders.routes.js";
import { FoldersServiceImpl } from "./services/folders.service.impl.js";

export function createFoldersModule(client: DynamoDBDocumentClient, tableName: string) {
  const repository = new DynamoFoldersRepository(client, tableName);
  const service = new FoldersServiceImpl(repository);
  const controller = new FoldersController(service);
  return { service, router: createFoldersRouter(controller) };
}

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { LibraryController } from "./controllers/library.controller.js";
import { DynamoLibraryRepository } from "./repository/dynamo-library.repository.js";
import { LibraryServiceImpl } from "./services/library.service.impl.js";
import { createLibraryRouter } from "./routes/library.routes.js";
export function createLibraryModule(client: DynamoDBDocumentClient, tableName: string) {
  const service = new LibraryServiceImpl(new DynamoLibraryRepository(client, tableName));
  return { service, router: createLibraryRouter(new LibraryController(service)) };
}

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { FinanceController } from "./controllers/finance.controller.js";
import { DynamoFinanceRepository } from "./repository/dynamo-finance.repository.js";
import { createFinanceRouter } from "./routes/finance.routes.js";
import { FinanceServiceImpl } from "./services/finance.service.impl.js";
export function createFinanceModule(client: DynamoDBDocumentClient, tableName: string) {
  const service = new FinanceServiceImpl(new DynamoFinanceRepository(client, tableName));
  return { service, router: createFinanceRouter(new FinanceController(service)) };
}

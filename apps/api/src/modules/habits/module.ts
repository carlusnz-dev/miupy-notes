import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { HabitsController } from "./controllers/habits.controller.js";
import { DynamoHabitsRepository } from "./repository/dynamo-habits.repository.js";
import { createHabitsRouter } from "./routes/habits.routes.js";
import { HabitsServiceImpl } from "./services/habits.service.impl.js";

export type HabitsOptions = {
  /**
   * Flag de configuração, desligada por padrão. Não há adaptador: mesmo ligada, nada é enviado ao Google
   * (`available` fica `false` até existir conector autorizado).
   */
  googleCalendarEnabled?: boolean;
};

export function createHabitsModule(client: DynamoDBDocumentClient, tableName: string, options: HabitsOptions = {}) {
  const service = new HabitsServiceImpl(new DynamoHabitsRepository(client, tableName));
  const settings = { googleCalendar: { enabled: options.googleCalendarEnabled ?? false, available: false } };
  return { service, router: createHabitsRouter(new HabitsController(service, settings)) };
}

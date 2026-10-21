import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CalendarController } from "./controllers/calendar.controller.js";
import { DynamoCalendarRepository } from "./repository/dynamo-calendar.repository.js";
import { createCalendarRouter } from "./routes/calendar.routes.js";
import { CalendarServiceImpl } from "./services/calendar.service.impl.js";
import { GoogleIntegrationServiceImpl, type GoogleIntegrationDeps } from "./services/google-integration.service.impl.js";
import type { NoteDirectory } from "./services/note-directory.js";

/**
 * `google` ausente = integração "não configurada": o status diz isso e nenhuma chamada ao Google acontece.
 * Só se passa `google` com cliente OAuth e cofre de credenciais protegidos (ver docs/arquitetura/api-calendar.md).
 */
export function createCalendarModule(client: DynamoDBDocumentClient, tableName: string, notes: NoteDirectory, google: GoogleIntegrationDeps | null = null) {
  const repository = new DynamoCalendarRepository(client, tableName);
  const service = new CalendarServiceImpl(repository, notes);
  const integration = new GoogleIntegrationServiceImpl(repository, google);
  return { service, router: createCalendarRouter(new CalendarController(service, integration)) };
}

import { createRemoteJWKSet } from "jose";
import { logger } from "./core/logging/logger.js";
import { createApp } from "./app.js";
import { authenticate, bearerTokenClaims, GOOGLE_JWKS_URL, parseAllowedSubs } from "./core/http/authenticate.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { createDataModules } from "./compose.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} (veja apps/api/README.md).`);
  return value;
}

// A API local só fala com DynamoDB Local; a tabela real é exclusiva da Lambda.
const endpoint = new URL(required("DYNAMODB_ENDPOINT"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("DYNAMODB_ENDPOINT deve apontar para o DynamoDB Local.");

const { notes, folders, finance, calendar } = createDataModules(createDynamoClient(endpoint.href), required("NOTES_TABLE_NAME"));
const claims = bearerTokenClaims(createRemoteJWKSet(GOOGLE_JWKS_URL), required("GOOGLE_CLIENT_ID"));
const app = createApp({ authenticate: authenticate(claims, parseAllowedSubs(process.env.ALLOWED_SUBS)), notesRouter: notes.router, foldersRouter: folders.router, financeRouter: finance.router, calendarRouter: calendar.router });

logger.info("dependencies.configured", { dependency: "dynamodb-local" });
const port = Number(process.env.PORT ?? 4000);
app.listen(port, "127.0.0.1", () => {
  logger.info("server.listening", { port });
});

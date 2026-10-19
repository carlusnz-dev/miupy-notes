import { createRemoteJWKSet } from "jose";
import { createApp } from "./app.js";
import { authenticate, bearerTokenClaims, GOOGLE_JWKS_URL, parseAllowedSubs } from "./core/http/authenticate.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { createFinanceModule } from "./modules/finance/index.js";
import { createNotesModule } from "./modules/notes/index.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} (veja apps/api/README.md).`);
  return value;
}

// A API local só fala com DynamoDB Local; a tabela real é exclusiva da Lambda.
const endpoint = new URL(required("DYNAMODB_ENDPOINT"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("DYNAMODB_ENDPOINT deve apontar para o DynamoDB Local.");

const finance = createFinanceModule(createDynamoClient(endpoint.href), required("NOTES_TABLE_NAME"));
const notes = createNotesModule(createDynamoClient(endpoint.href), required("NOTES_TABLE_NAME"));
const claims = bearerTokenClaims(createRemoteJWKSet(GOOGLE_JWKS_URL), required("GOOGLE_CLIENT_ID"));
const app = createApp({ authenticate: authenticate(claims, parseAllowedSubs(process.env.ALLOWED_SUBS)), notesRouter: notes.router, financeRouter: finance.router });

const port = Number(process.env.PORT ?? 4000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`API local em http://127.0.0.1:${port}\n`);
});

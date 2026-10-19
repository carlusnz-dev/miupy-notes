import serverless from "serverless-http";
import { createApp } from "./app.js";
import { authenticate, lambdaAuthorizerClaims, parseAllowedSubs } from "./core/http/authenticate.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { createDataModules } from "./compose.js";

// Não implantado. O JWT authorizer do API Gateway valida o token; aqui só se aplicam as claims e a lista de `sub`.
const { notes, folders, finance } = createDataModules(createDynamoClient(), process.env.NOTES_TABLE_NAME ?? "");
const app = createApp({ authenticate: authenticate(lambdaAuthorizerClaims, parseAllowedSubs(process.env.ALLOWED_SUBS)), notesRouter: notes.router, foldersRouter: folders.router, financeRouter: finance.router });

export const handler = serverless(app, {
  request(request: { requestContext?: unknown }, event: { requestContext?: unknown }) {
    request.requestContext = event.requestContext;
  },
});

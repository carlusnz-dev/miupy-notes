import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Express, RequestHandler } from "express";
import serverless from "serverless-http";
import { createApp } from "./app.js";
import { createDataModules } from "./compose.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { lambdaAuthorizerClaims, parseAllowedSubs, principalFromClaims } from "./core/http/authenticate.js";
import { logger } from "./core/logging/logger.js";

type HttpEvent = { requestContext?: unknown };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} para a Lambda.`);
  return value;
}

/** O API Gateway valida o JWT; o adaptador conserva as claims para o middleware de autorização. */
export function adaptApp(app: Express) {
  return serverless(app, {
    request(request: { requestContext?: unknown }, event: HttpEvent) {
      request.requestContext = event.requestContext;
    },
  });
}

/** Cache curto por ambiente; falha de leitura após expirar nega a requisição. */
export function createAllowedSubsLoader(read: () => Promise<string | undefined>, now = Date.now) {
  let cache: { value: ReadonlySet<string>; expiresAt: number } | undefined;
  let pending: Promise<ReadonlySet<string>> | undefined;
  return () => {
    if (cache && now() < cache.expiresAt) return Promise.resolve(cache.value);
    pending ??= read().then((value) => {
      const allowedSubs = parseAllowedSubs(value);
      if (allowedSubs.size === 0) throw new Error("ALLOWED_SUBS_SECRET_ARN deve conter ao menos um sub.");
      cache = { value: allowedSubs, expiresAt: now() + 60_000 };
      return allowedSubs;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

async function createHandler() {
  const tableName = required("NOTES_TABLE_NAME");
  const secretArn = required("ALLOWED_SUBS_SECRET_ARN");
  const secrets = new SecretsManagerClient({});
  const allowedSubs = createAllowedSubsLoader(async () => (await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }))).SecretString);
  await allowedSubs();
  const authorize: RequestHandler = async (req, res, next) => {
    try {
      res.locals.principal = principalFromClaims(await lambdaAuthorizerClaims(req), await allowedSubs());
      next();
    } catch (error) { next(error); }
  };

  const { notes, folders, finance, calendar, library } = createDataModules(createDynamoClient(), tableName);
  const app = createApp({
    authenticate: authorize,
    notesRouter: notes.router,
    foldersRouter: folders.router,
    financeRouter: finance.router,
    calendarRouter: calendar.router,
    libraryRouter: library.router,
  });
  logger.info("dependencies.configured", { dependency: "dynamodb" });
  return adaptApp(app);
}

let runtime: ReturnType<typeof createHandler> | undefined;
export async function handler(event: Parameters<Awaited<ReturnType<typeof createHandler>>>[0], context: Parameters<Awaited<ReturnType<typeof createHandler>>>[1]) {
  runtime ??= createHandler();
  return (await runtime)(event, context);
}

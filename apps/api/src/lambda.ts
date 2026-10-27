import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Express, RequestHandler } from "express";
import serverless from "serverless-http";
import { createApp } from "./app.js";
import { createDataModules } from "./compose.js";
import { createDynamoClient } from "./core/dynamo/client.js";
import { ConfigurationError, DependencyError } from "./core/domain/app-error.js";
import { lambdaAuthorizerClaims, parseAllowedSubs, principalFromClaims } from "./core/http/authenticate.js";
import { parseAllowedCidrs, sourceIpGuard } from "./core/http/source-ip-guard.js";
import { describeError, logger } from "./core/logging/logger.js";

type HttpEvent = { requestContext?: unknown };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(name, `Defina ${name} para a Lambda.`);
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
      if (allowedSubs.size === 0) throw new ConfigurationError("ALLOWED_SUBS_SECRET_ARN", "ALLOWED_SUBS_SECRET_ARN deve conter ao menos um sub.");
      cache = { value: allowedSubs, expiresAt: now() + 60_000 };
      return allowedSubs;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

/** Em produção o SDK usa só os endpoints AWS padrão (HTTPS); variáveis que os redirecionam, inclusive para HTTP, são recusadas. */
function assertDefaultAwsEndpoints() {
  const override = Object.keys(process.env).find((name) => name.startsWith("AWS_ENDPOINT_URL"));
  if (override) throw new ConfigurationError(override, `Remova ${override}: a Lambda só usa os endpoints AWS padrão.`);
}

async function createHandler() {
  assertDefaultAwsEndpoints();
  const tableName = required("NOTES_TABLE_NAME");
  const secretArn = required("ALLOWED_SUBS_SECRET_ARN");
  const allowedCidrs = parseAllowedCidrs(required("ALLOWED_CIDRS"));
  const secrets = new SecretsManagerClient({});
  const allowedSubs = createAllowedSubsLoader(async () => {
    try { return (await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }))).SecretString; }
    catch (error) { throw new DependencyError("secretsmanager", "GetSecretValue", error); }
  });
  await allowedSubs();
  const authorize: RequestHandler = async (req, res, next) => {
    try {
      res.locals.principal = principalFromClaims(await lambdaAuthorizerClaims(req), await allowedSubs());
      next();
    } catch (error) { next(error); }
  };

  const { notes, folders, finance, calendar, library } = createDataModules(createDynamoClient(), tableName);
  const app = createApp({
    sourceGuard: sourceIpGuard(allowedCidrs),
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

type LambdaRuntime = Awaited<ReturnType<typeof createHandler>>;

/** Separa falha de inicialização (nova tentativa na próxima invocação) de falha da requisição (runtime preservado). */
export function createLambdaHandler(init: () => Promise<LambdaRuntime>) {
  let runtime: Promise<LambdaRuntime> | undefined;
  return async (event: Parameters<LambdaRuntime>[0], context: Parameters<LambdaRuntime>[1]) => {
    runtime ??= init();
    let invoke: LambdaRuntime;
    try {
      invoke = await runtime;
    } catch (error) {
      // Falha de inicialização (configuração, segredo): registra a causa e tenta de novo na próxima invocação.
      runtime = undefined;
      logger.error("lambda.init_failed", { module: "lambda", ...describeError(error), operation: "createHandler" });
      throw error;
    }
    try {
      return await invoke(event, context);
    } catch (error) {
      logger.error("lambda.invoke_failed", { module: "lambda", ...describeError(error), operation: "invoke" });
      throw error;
    }
  };
}

export const handler = createLambdaHandler(createHandler);

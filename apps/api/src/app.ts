import express, { type RequestHandler, type Router } from "express";
import { captureErrorRoute, requestLogger } from "./core/http/request-logger.js";
import { logger, type Logger } from "./core/logging/logger.js";
import { createErrorHandler } from "./core/http/error-handler.js";

/** Rotas pessoais só existem com autenticação: sem ela, `/v1` responde 404. */
export type ApiRoutes = { authenticate: RequestHandler; notesRouter: Router; foldersRouter?: Router; financeRouter?: Router; calendarRouter?: Router };

export function createApp(api?: ApiRoutes, log: Logger = logger) {
  const app = express();
  app.disable("x-powered-by");
  // requestId antes do parser: erros de JSON também precisam dele na resposta.
  app.use(requestLogger(log));
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  if (api) {
    app.use("/v1", api.authenticate);
    app.use("/v1/notes", api.notesRouter, captureErrorRoute("/v1/notes"));
    if (api.foldersRouter) app.use("/v1/folders", api.foldersRouter, captureErrorRoute("/v1/folders"));
    if (api.financeRouter) app.use("/v1/finance", api.financeRouter, captureErrorRoute("/v1/finance"));
    if (api.calendarRouter) app.use("/v1/calendar", api.calendarRouter, captureErrorRoute("/v1/calendar"));
  }
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada.", requestId: res.locals.requestId } }));
  app.use(createErrorHandler(log));
  return app;
}

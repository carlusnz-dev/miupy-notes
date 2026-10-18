import { randomUUID } from "node:crypto";
import express, { type RequestHandler, type Router } from "express";
import { errorHandler } from "./core/http/error-handler.js";

/** Rotas pessoais só existem com autenticação: sem ela, `/v1` responde 404. */
export type ApiRoutes = { authenticate: RequestHandler; notesRouter: Router };

export function createApp(api?: ApiRoutes) {
  const app = express();
  app.disable("x-powered-by");
  // requestId antes do parser: erros de JSON também precisam dele na resposta.
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  if (api) {
    app.use("/v1", api.authenticate);
    app.use("/v1/notes", api.notesRouter);
  }
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada.", requestId: res.locals.requestId } }));
  app.use(errorHandler);
  return app;
}

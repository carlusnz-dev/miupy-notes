import { randomUUID } from "node:crypto";
import express from "express";
import { errorHandler } from "./core/http/error-handler.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // requestId antes do parser: erros de JSON também precisam dele na resposta.
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Notes routes are wired only after an authentication strategy is implemented.
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada.", requestId: res.locals.requestId } }));
  app.use(errorHandler);
  return app;
}

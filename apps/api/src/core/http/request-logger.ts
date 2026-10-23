import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { logger, type Logger } from "../logging/logger.js";

export function requestMethod(req: Request): string {
  return ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS", "HEAD"].includes(req.method) ? req.method : "OTHER";
}

export function requestRoute(req: Request, res?: Response): string {
  if (res?.locals.logRoute) return res.locals.logRoute as string;
  const path: unknown = req.route?.path;
  // Só templates definidos pelo servidor; baseUrl arbitrária nunca entra no log.
  if (typeof path === "string" && /^\/[a-zA-Z0-9/:._-]*$/.test(path)) {
    const base = ["/v1/notes", "/v1/folders", "/v1/finance", "/v1/calendar", "/v1/library"].includes(req.baseUrl) ? req.baseUrl : "";
    return `${base}${path}`;
  }
  return "unmatched";
}
// Captura antes que o Express restaure baseUrl ao sair do router em erro.
export function captureErrorRoute(prefix: "/v1/notes" | "/v1/folders" | "/v1/finance" | "/v1/calendar" | "/v1/library"): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    const path: unknown = req.route?.path;
    if (typeof path === "string" && /^\/[a-zA-Z0-9/:._-]*$/.test(path)) res.locals.logRoute = `${prefix}${path}`;
    next(error);
  };
}

export function requestLogger(log: Logger = logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const start = performance.now();
    const method = requestMethod(req);
    log.debug("request.started", { requestId, method, route: "unmatched" });
    let finished = false;
    const complete = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      log.info(aborted ? "request.aborted" : "request.completed", { requestId, method, route: requestRoute(req, res), statusCode: aborted ? undefined : res.statusCode, durationMs: Math.round((performance.now() - start) * 100) / 100 });
    };
    res.once("finish", () => complete(false));
    res.once("close", () => complete(!res.writableFinished));
    next();
  };
}

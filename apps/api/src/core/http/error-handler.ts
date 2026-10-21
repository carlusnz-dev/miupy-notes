import type { ErrorRequestHandler, Response } from "express";
import { classifyError, logger, type Logger, type LogFields } from "../logging/logger.js";
import { requestMethod, requestRoute } from "./request-logger.js";
import { ZodError } from "zod";
import { AppError } from "../domain/app-error.js";

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}

// Erros do parser de JSON do Express trazem `type`; sem este mapeamento virariam 500.
function bodyErrorType(error: unknown): unknown {
  return typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
}

export function createErrorHandler(log: Logger = logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const expected = error instanceof ZodError || (error instanceof AppError && error.status < 500) || bodyErrorType(error) === "entity.parse.failed" || bodyErrorType(error) === "entity.too.large";
    const bodyError = bodyErrorType(error);
    const statusCode = error instanceof ZodError || bodyError === "entity.parse.failed" ? 400 : error instanceof AppError ? error.status : bodyError === "entity.too.large" ? 413 : 500;
    const reason: LogFields["reason"] = bodyError === "entity.parse.failed" ? "invalid_json" : bodyError === "entity.too.large" ? "payload_too_large" : undefined;
    const fields = { requestId: res.locals.requestId as string, method: requestMethod(req), statusCode, route: requestRoute(req, res), reason, ...classifyError(error), ...(expected ? { classification: "request_rejected" } : {}) };
    if (expected) log.warn("request.failed", fields);
    else log.error("request.failed", fields);
    // Não delegar Error bruto ao handler padrão: ele imprime mensagem/stack em dev.
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof ZodError) return sendError(res, 400, "VALIDATION_ERROR", "Dados inválidos.");
    if (error instanceof AppError) return sendError(res, error.status, error.code, error.message);
    if (bodyError === "entity.parse.failed") return sendError(res, 400, "VALIDATION_ERROR", "JSON inválido.");
    if (bodyError === "entity.too.large") return sendError(res, 413, "PAYLOAD_TOO_LARGE", "Conteúdo maior que o permitido.");
    sendError(res, 500, "INTERNAL_ERROR", "Erro interno.");
  };
}
export const errorHandler = createErrorHandler();

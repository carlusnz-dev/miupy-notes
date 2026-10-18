import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../domain/app-error.js";

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}

// Erros do parser de JSON do Express trazem `type`; sem este mapeamento virariam 500.
function bodyErrorType(error: unknown): unknown {
  return typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) return sendError(res, 400, "VALIDATION_ERROR", "Dados inválidos.");
  if (error instanceof AppError) return sendError(res, error.status, error.code, error.message);
  const bodyError = bodyErrorType(error);
  if (bodyError === "entity.parse.failed") return sendError(res, 400, "VALIDATION_ERROR", "JSON inválido.");
  if (bodyError === "entity.too.large") return sendError(res, 413, "PAYLOAD_TOO_LARGE", "Conteúdo maior que o permitido.");
  sendError(res, 500, "INTERNAL_ERROR", "Erro interno.");
};

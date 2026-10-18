import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../domain/app-error.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", requestId: res.locals.requestId } });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno.", requestId: res.locals.requestId } });
};

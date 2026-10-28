import { ZodError, type ZodType } from "zod";
/** Rótulos de diagnóstico escolhidos pelo código (nunca texto de exceção, token ou dado da requisição). */
export type FailureContext = { service?: string; operation?: string; detail?: string; providerStatus?: number };

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly context?: FailureContext,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** Falha inesperada de um serviço externo: vira 500 e o log leva serviço, operação e causa original. */
export class ServiceError extends Error {
  override name = "ServiceError";
  constructor(public readonly context: FailureContext & { service: string; operation: string }, cause?: unknown) {
    super(`${context.service}: ${context.operation}`, cause === undefined ? undefined : { cause });
  }
}

/**
 * Valida dado que o servidor leu do armazenamento ou vai devolver. A entrada do cliente continua em `schema.parse` (400);
 * aqui uma falha é corrupção ou bug, então vira `ServiceError` (500) sem carregar o conteúdo do dado.
 */
export function parseInternal<T>(schema: ZodType<T>, value: unknown, context: FailureContext & { service: string; operation: string }): T {
  try { return schema.parse(value); }
  catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const failure = new ServiceError(context, error);
    // Sem os quadros deste helper, a "origem" do log aponta o código que leu ou montou o dado.
    Error.captureStackTrace(failure, parseInternal);
    throw failure;
  }
}

/** Configuração ausente ou inválida; `setting` e `message` nunca carregam valores sensíveis. */
export class ConfigurationError extends Error {
  override name = "ConfigurationError";
  constructor(public readonly setting: string, message: string) {
    super(message);
  }
}

/** Falha em serviço externo, com serviço e operação para o log; a causa original fica em `cause`. */
export class DependencyError extends Error {
  override name = "DependencyError";
  constructor(public readonly service: "secretsmanager", public readonly operation: string, cause: unknown) {
    super(`Falha em ${service}:${operation}.`, { cause });
  }
}

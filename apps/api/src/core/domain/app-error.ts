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
  constructor(public readonly context: FailureContext & { service: string; operation: string }, cause?: unknown) {
    super(`${context.service}: ${context.operation}`, cause === undefined ? undefined : { cause });
  }
}

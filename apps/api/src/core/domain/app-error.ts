export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
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

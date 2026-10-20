export type LogLevel = "debug" | "info" | "success" | "warn" | "error";
export type LogEvent = "request.started" | "request.completed" | "request.aborted" | "request.failed" | "server.listening" | "dependencies.configured";
export type LogFields = { requestId?: string; method?: string; route?: string; statusCode?: number; durationMs?: number; classification?: string; errorTypes?: string[]; reason?: "invalid_json" | "payload_too_large"; port?: number; dependency?: "dynamodb-local" | "dynamodb" };
export type LogSink = (line: string, level: LogLevel) => void;
type LoggerOptions = { format?: "pretty" | "json"; color?: boolean };
const levels: Record<LogLevel, number> = { debug: 0, info: 1, success: 1, warn: 2, error: 3 };
const colors: Record<LogLevel, number> = { debug: 90, info: 36, success: 32, warn: 33, error: 31 };

function statusReason(status?: number): string {
  switch (status) {
    case 400: return "Dados inválidos.";
    case 401: return "Autenticação ausente ou sessão expirada.";
    case 403: return "Acesso não permitido.";
    case 404: return "Rota ou registro não encontrado.";
    case 409: return "Conflito de versão; o registro foi alterado.";
    case 413: return "Conteúdo maior que o permitido.";
    case 422: return "Operação incompatível com os dados informados.";
    case 429: return "Limite de requisições atingido.";
    default: return status && status >= 500 ? "Falha interna ao processar a requisição." : "Requisição rejeitada.";
  }
}

/** Motivos controlados, sem interpolar mensagens de exceções ou valores da requisição. */
function messageFor(event: LogEvent, fields: LogFields): string {
  switch (event) {
    case "server.listening": return `Servidor pronto na porta ${fields.port}.`;
    case "dependencies.configured": return `${fields.dependency === "dynamodb-local" ? "DynamoDB Local" : "DynamoDB"} configurado; conexão ainda não verificada.`;
    case "request.started": return "Requisição iniciada.";
    case "request.aborted": return "Conexão interrompida antes de concluir a resposta.";
    case "request.completed": return fields.statusCode && fields.statusCode >= 400 ? `Resposta enviada. ${statusReason(fields.statusCode)}` : "Requisição concluída com sucesso.";
    case "request.failed":
      if (fields.reason === "invalid_json") return "JSON inválido no corpo da requisição.";
      if (fields.reason === "payload_too_large") return "Conteúdo maior que o permitido.";
      if (fields.classification === "dependency_unreachable") return "Não foi possível conectar ao serviço de dados; verifique se ele está disponível.";
      if (fields.classification === "dependency_resource_missing") return "Recurso de dados não encontrado; verifique a tabela configurada.";
      if (fields.classification === "dependency_error") return "Falha ao acessar um serviço necessário; verifique os códigos de diagnóstico.";
      return statusReason(fields.statusCode);
  }
}

/** Somente metadados explícitos; nunca passar objetos de request, Error ou SDK. */
export class Logger {
  private readonly threshold: number;
  private readonly format: "pretty" | "json";
  constructor(level: string = process.env.LOG_LEVEL ?? "info", private readonly sink: LogSink = (line, severity) => {
    (severity === "error" ? process.stderr : process.stdout).write(`${line}\n`);
  }, private readonly options: LoggerOptions = {}) {
    this.threshold = Object.hasOwn(levels, level) ? levels[level as LogLevel] : levels.info;
    this.format = options.format ?? (process.env.LOG_FORMAT === "json" ? "json" : "pretty");
  }
  debug(event: LogEvent, fields: LogFields = {}) { this.write("debug", event, fields); }
  info(event: LogEvent, fields: LogFields = {}) { this.write("info", event, fields); }
  success(event: LogEvent, fields: LogFields = {}) { this.write("success", event, fields); }
  warn(event: LogEvent, fields: LogFields = {}) { this.write("warn", event, fields); }
  error(event: LogEvent, fields: LogFields = {}) { this.write("error", event, fields); }
  private write(level: LogLevel, event: LogEvent, fields: LogFields) {
    if (event === "request.completed" && fields.statusCode !== undefined) {
      level = fields.statusCode >= 500 ? "error" : fields.statusCode >= 400 ? "warn" : "success";
    } else if (event === "request.aborted") level = "warn";
    if (levels[level] < this.threshold) return;
    // Cópia explícita impede campos extras em runtime (body, headers, cause, etc.).
    const { requestId, method, route, statusCode, durationMs, classification, errorTypes, reason, port, dependency } = fields;
    const timestamp = new Date().toISOString();
    const message = messageFor(event, fields);
    const metadata = { requestId, method, route, statusCode, durationMs, classification, errorTypes, reason, port, dependency };
    try {
      if (this.format === "json") {
        this.sink(JSON.stringify({ timestamp, level, event, message, ...metadata }), level);
        return;
      }
      const color = this.options.color ?? (process.env.NO_COLOR === undefined && process.env.TERM !== "dumb" && Boolean(level === "error" ? process.stderr.isTTY : process.stdout.isTTY));
      const label = color ? `\x1b[${colors[level]}m${level.toUpperCase()}\x1b[0m` : level.toUpperCase();
      const request = event.startsWith("request.");
      const context = request ? `${method ?? "OTHER"} ${route === "unmatched" || !route ? "[rota não identificada]" : route} ` : "";
      const details = request ? [statusCode === undefined ? null : `HTTP ${statusCode}`, durationMs === undefined ? null : `${durationMs} ms`, requestId ? `requestId=${requestId}` : null, ...(errorTypes ?? [])].filter(Boolean) : [];
      this.sink(`${timestamp} ${label} - ${context}${message}${details.length ? ` [${details.join(" | ")}]` : ""}`, level);
    }
    catch { /* Falha do destino de logs não deve derrubar uma requisição. */ }
  }
}
export const logger = new Logger();

const errorTypes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ResourceNotFoundException", "AccessDeniedException", "UnrecognizedClientException", "CredentialsProviderError", "ProvisionedThroughputExceededException", "ThrottlingException", "TimeoutError", "AbortError", "AggregateError"]);
export function classifyError(error: unknown): Pick<LogFields, "classification" | "errorTypes"> {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 5) return;
    seen.add(value);
    for (const key of ["name", "code"] as const) {
      const name = (value as Record<string, unknown>)[key];
      if (typeof name === "string" && errorTypes.has(name)) found.add(name);
    }
    visit((value as { cause?: unknown }).cause, depth + 1);
    const errors = (value as { errors?: unknown }).errors;
    if (Array.isArray(errors)) for (const nested of errors.slice(0, 10)) visit(nested, depth + 1);
  }
  visit(error, 0);
  const classification = found.has("ECONNREFUSED") ? "dependency_unreachable" : found.has("ResourceNotFoundException") ? "dependency_resource_missing" : found.size ? "dependency_error" : "unknown_error";
  return { classification, errorTypes: [...found] };
}

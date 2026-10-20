export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogEvent = "request.started" | "request.completed" | "request.aborted" | "request.failed" | "server.listening" | "dependencies.configured";
export type LogFields = { requestId?: string; method?: string; route?: string; statusCode?: number; durationMs?: number; classification?: string; errorTypes?: string[]; port?: number; dependency?: "dynamodb-local" | "dynamodb" };
export type LogSink = (line: string, level: LogLevel) => void;
const levels: LogLevel[] = ["debug", "info", "warn", "error"];

/** Somente metadados explícitos; nunca passar objetos de request, Error ou SDK. */
export class Logger {
  private readonly threshold: number;
  constructor(level: string = process.env.LOG_LEVEL ?? "info", private readonly sink: LogSink = (line, severity) => {
    (severity === "error" ? process.stderr : process.stdout).write(`${line}\n`);
  }) {
    this.threshold = levels.includes(level as LogLevel) ? levels.indexOf(level as LogLevel) : 1;
  }
  debug(event: LogEvent, fields: LogFields = {}) { this.write("debug", event, fields); }
  info(event: LogEvent, fields: LogFields = {}) { this.write("info", event, fields); }
  warn(event: LogEvent, fields: LogFields = {}) { this.write("warn", event, fields); }
  error(event: LogEvent, fields: LogFields = {}) { this.write("error", event, fields); }
  private write(level: LogLevel, event: LogEvent, fields: LogFields) {
    if (levels.indexOf(level) < this.threshold) return;
    // Cópia explícita impede campos extras em runtime (body, headers, cause, etc.).
    const { requestId, method, route, statusCode, durationMs, classification, errorTypes, port, dependency } = fields;
    try { this.sink(JSON.stringify({ timestamp: new Date().toISOString(), level, event, requestId, method, route, statusCode, durationMs, classification, errorTypes, port, dependency }), level); }
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

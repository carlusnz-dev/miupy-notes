import type { FailureContext } from "../domain/app-error.js";
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";
export type LogEvent = "request.started" | "request.completed" | "request.aborted" | "request.failed" | "server.listening" | "dependencies.configured";
export type LogFields = { requestId?: string; method?: string; route?: string; statusCode?: number; durationMs?: number; classification?: string; errorTypes?: string[]; reason?: "invalid_json" | "payload_too_large"; port?: number; dependency?: "dynamodb-local" | "dynamodb"; service?: string; operation?: string; detail?: string; providerStatus?: number; errorChain?: string[]; origin?: string };
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
      if (fields.service) return `Falha em ${fields.service}${fields.operation ? ` ao ${fields.operation}` : ""}.${fields.classification === "dependency_resource_missing" ? " Recurso não encontrado; verifique a tabela configurada." : ""}`;
      if (fields.classification === "dependency_unreachable") return "Não foi possível conectar ao serviço de dados; verifique se ele está disponível.";
      if (fields.classification === "dependency_resource_missing") return "Recurso de dados não encontrado; verifique a tabela configurada.";
      if (fields.classification === "dependency_error") return "Falha ao acessar um serviço necessário; verifique os códigos de diagnóstico.";
      return statusReason(fields.statusCode);
  }
}

function label(value: unknown, max = 80): string | undefined {
  return typeof value === "string" ? value.replace(/[^\p{L}\p{N} _.:()/>@-]/gu, "").slice(0, max) || undefined : undefined;
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
    // Rótulos de diagnóstico passam por filtro: só identificadores curtos chegam ao log, nunca texto livre.
    const service = label(fields.service), operation = label(fields.operation), detail = label(fields.detail), origin = label(fields.origin, 100);
    const providerStatus = Number.isInteger(fields.providerStatus) && fields.providerStatus! >= 100 && fields.providerStatus! <= 599 ? fields.providerStatus : undefined;
    const errorChain = fields.errorChain?.slice(0, 6).map(cause => label(cause, 64)).filter((cause): cause is string => Boolean(cause));
    const timestamp = new Date().toISOString();
    const message = messageFor(event, { ...fields, service, operation });
    const metadata = { requestId, method, route, statusCode, durationMs, classification, errorTypes, reason, port, dependency, service, operation, detail, providerStatus, errorChain, origin };
    try {
      if (this.format === "json") {
        this.sink(JSON.stringify({ timestamp, level, event, message, ...metadata }), level);
        return;
      }
      const color = this.options.color ?? (process.env.NO_COLOR === undefined && process.env.TERM !== "dumb" && Boolean(level === "error" ? process.stderr.isTTY : process.stdout.isTTY));
      const label = color ? `\x1b[${colors[level]}m${level.toUpperCase()}\x1b[0m` : level.toUpperCase();
      const request = event.startsWith("request.");
      const context = request ? `${method ?? "OTHER"} ${route === "unmatched" || !route ? "[rota não identificada]" : route} ` : "";
      const details = request ? [statusCode === undefined ? null : `HTTP ${statusCode}`, durationMs === undefined ? null : `${durationMs} ms`, requestId ? `requestId=${requestId}` : null, ...(errorTypes ?? []), detail ? `detalhe=${detail}` : null, providerStatus ? `provedor=HTTP ${providerStatus}` : null, errorChain?.length ? `causa=${errorChain.join(" > ")}` : null, origin ? `origem=${origin}` : null].filter(Boolean) : [];
      this.sink(`${timestamp} ${label} - ${context}${message}${details.length ? ` [${details.join(" | ")}]` : ""}`, level);
    }
    catch { /* Falha do destino de logs não deve derrubar uma requisição. */ }
  }
}
export const logger = new Logger();

const errorTypes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ResourceNotFoundException", "AccessDeniedException", "UnrecognizedClientException", "CredentialsProviderError", "ProvisionedThroughputExceededException", "ThrottlingException", "TimeoutError", "AbortError", "AggregateError"]);
/** Primeiro quadro da pilha dentro de `src/` (caminho relativo): aponta o ponto do código sem expor mensagem nem valores. */
function originOf(error: unknown): string | undefined {
  const stack = typeof error === "object" && error !== null ? (error as { stack?: unknown }).stack : undefined;
  return typeof stack === "string" ? /[/\\](src[/\\][^\s():]+:\d+)/.exec(stack)?.[1].replaceAll("\\", "/") : undefined;
}

/** `Nome` ou `Nome(CÓDIGO)` (só errno/ERR_ do Node e do jose) de cada erro na cadeia de causas; `skipFirst` pula o próprio erro quando ele só embrulha a causa. */
function causeChain(error: unknown, skipFirst: boolean): string[] {
  const names: string[] = [];
  const visited = new Set<unknown>();
  for (let value: unknown = error, depth = 0; value && typeof value === "object" && !visited.has(value) && depth < 6; value = (value as { cause?: unknown }).cause, depth++) {
    visited.add(value);
    if (depth === 0 && skipFirst) continue;
    const { name, code } = value as { name?: unknown; code?: unknown };
    const safeName = typeof name === "string" && /^[A-Za-z][\w$.-]{0,63}$/.test(name) ? name : "Error";
    names.push(typeof code === "string" && /^(E[A-Z0-9]+|ERR_[A-Z0-9_]+)$/.test(code) ? `${safeName}(${code})` : safeName);
  }
  return names;
}

export function classifyError(error: unknown): Pick<LogFields, "classification" | "errorTypes" | "service" | "operation" | "detail" | "providerStatus" | "errorChain" | "origin"> {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  let context: FailureContext | undefined;
  let awsStatus: number | undefined;
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 5) return;
    seen.add(value);
    for (const key of ["name", "code"] as const) {
      const name = (value as Record<string, unknown>)[key];
      if (typeof name === "string" && errorTypes.has(name)) found.add(name);
    }
    const own = (value as { context?: unknown }).context;
    if (!context && typeof own === "object" && own !== null) context = own as FailureContext;
    const status = (value as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
    if (awsStatus === undefined && typeof status === "number") awsStatus = status;
    visit((value as { cause?: unknown }).cause, depth + 1);
    const errors = (value as { errors?: unknown }).errors;
    if (Array.isArray(errors)) for (const nested of errors.slice(0, 10)) visit(nested, depth + 1);
  }
  visit(error, 0);
  const classification = found.has("ECONNREFUSED") ? "dependency_unreachable" : found.has("ResourceNotFoundException") ? "dependency_resource_missing" : found.size ? "dependency_error" : "unknown_error";
  const wrapper = typeof error === "object" && error !== null && (error as { context?: unknown }).context !== undefined;
  const origin = originOf(error) ?? originOf((error as { cause?: unknown } | null)?.cause);
  return { classification, errorTypes: [...found], service: context?.service ?? (awsStatus === undefined ? undefined : "DynamoDB"), operation: context?.operation, detail: context?.detail, providerStatus: context?.providerStatus ?? awsStatus, errorChain: causeChain(error, wrapper), origin };
}

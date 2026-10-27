import type { z } from "zod";

export type ToolErrorCode = "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "PAYLOAD_TOO_LARGE" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "INTERNAL_ERROR";

/** Erro já sanitizado: só código, mensagem pública e o `requestId` da API para correlação com os logs dela. */
export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string, readonly requestId?: string) { super(message); }
}

const byStatus: Record<number, [ToolErrorCode, string]> = {
  400: ["VALIDATION_ERROR", "A API rejeitou os dados enviados."],
  401: ["UNAUTHORIZED", "Token da API ausente, inválido ou expirado."],
  403: ["FORBIDDEN", "Esta conta não tem acesso."],
  404: ["NOT_FOUND", "Registro não encontrado."],
  409: ["CONFLICT", "A nota foi alterada por outra operação. Leia de novo com notes_get e repita com a versão atual."],
  413: ["PAYLOAD_TOO_LARGE", "Conteúdo maior que o permitido pela API."],
  429: ["RATE_LIMITED", "Limite de requisições da API atingido. Tente mais tarde."],
};

function errorFromResponse(status: number, body: unknown): ToolError {
  const [code, message] = byStatus[status] ?? ["UPSTREAM_UNAVAILABLE", "A API está indisponível ou falhou."];
  const envelope = typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : undefined;
  const requestId = typeof envelope === "object" && envelope !== null && "requestId" in envelope && typeof envelope.requestId === "string" ? envelope.requestId : undefined;
  return new ToolError(code, message, requestId);
}

export type ApiClient = {
  get<S extends z.ZodType>(path: string, schema: S, query?: Record<string, string | number>): Promise<z.infer<S>>;
  post<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>>;
  patch<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>>;
};

export type ApiClientOptions = {
  baseUrl: string;
  /** Lido a cada chamada: o cliente não guarda token, então não há estado entre usuários nem token vencido em cache. */
  token: () => string | Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Token em claro só para a API local: fora de loopback exige HTTPS. */
export function assertSafeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error("MIUPY_API_BASE_URL deve usar HTTPS (HTTP só em loopback).");
  }
  return url;
}

export function createApiClient({ baseUrl, token, timeoutMs = 10_000, fetchImpl = fetch }: ApiClientOptions): ApiClient {
  const root = assertSafeBaseUrl(baseUrl).href.replace(/\/$/, "");

  async function request<S extends z.ZodType>(method: string, path: string, schema: S, init: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<z.infer<S>> {
    const url = new URL(`${root}/v1${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { authorization: `Bearer ${await token()}`, accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      // `redirect: "error"` impede que o Authorization seja reenviado a outro host.
      response = await fetchImpl(url, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError("UPSTREAM_UNAVAILABLE", "A API não respondeu.");
    }
    const parsed: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw errorFromResponse(response.status, parsed);
    const result = schema.safeParse(parsed);
    if (!result.success) throw new ToolError("UPSTREAM_UNAVAILABLE", "Resposta inesperada da API.");
    return result.data;
  }

  // Sem retentativas: `POST /notes` não é idempotente e repetir criaria outra nota.
  return {
    get: (path, schema, query) => request("GET", path, schema, { query }),
    post: (path, body, schema) => request("POST", path, schema, { body }),
    patch: (path, body, schema) => request("PATCH", path, schema, { body }),
  };
}

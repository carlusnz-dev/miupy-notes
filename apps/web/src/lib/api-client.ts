import axios, { AxiosError } from "axios";
import { z } from "zod";
import { requestBudget } from "./request-budget";
import { apiBaseUrlSchema } from "./api-base-url";

const env = z.object({ VITE_API_BASE_URL: apiBaseUrlSchema.optional() }).parse(import.meta.env ?? {});

type AccessTokenProvider = () => Promise<string>;
let accessTokenProvider: AccessTokenProvider | null = null;
let authEpoch = 0;
let unauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) { unauthorized = handler; }

/** Definido por `lib/auth.ts` ao entrar (ID token do Google via comando Tauri) e zerado ao sair. */
export function setAccessTokenProvider(provider: AccessTokenProvider | null) {
  if (accessTokenProvider !== provider) authEpoch++;
  accessTokenProvider = provider;
}

export function isAuthConfigured(): boolean {
  return accessTokenProvider !== null;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    /** `Retry-After` da resposta, em ms (só chega ao app se a API o expuser via CORS). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const apiClient = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  timeout: 10_000,
});

// Sem provedor de token, nenhuma requisição sai do app: dados pessoais só trafegam autenticados.
apiClient.interceptors.request.use(async (config) => {
  if (!accessTokenProvider) {
    throw new ApiError("AUTH_NOT_CONFIGURED", "Nenhuma conta conectada. Nenhuma requisição foi enviada.");
  }
  const previousEpoch = (config as typeof config & { authEpoch?: number }).authEpoch;
  if (previousEpoch !== undefined && previousEpoch !== authEpoch) throw new ApiError("UNAUTHORIZED", "Sua sessão terminou. Entre de novo.", 401);
  const provider = accessTokenProvider;
  const epoch = authEpoch;
  const token = await provider();
  await requestBudget.acquire(config.signal);
  if (config.signal?.aborted) throw new axios.CanceledError();
  if (epoch !== authEpoch) throw new ApiError("UNAUTHORIZED", "Sua sessão terminou. Entre de novo.", 401);
  (config as typeof config & { authEpoch?: number }).authEpoch = epoch;
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
});

function retryAfterMs(error: AxiosError): number | undefined {
  const raw = error.response?.headers?.["retry-after"];
  if (typeof raw !== "string") return undefined;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AxiosError) {
    const body = errorBodySchema.safeParse(error.response?.data);
    if (error.response?.status === 401) return new ApiError("UNAUTHORIZED", "Sua sessão terminou. Entre de novo.", 401, body.success ? body.data.error.requestId : undefined);
    if (body.success) return new ApiError(body.data.error.code,
      body.data.error.code === "ORIGIN_NOT_ALLOWED" ? "Acesso bloqueado para este IP. Verifique seu IP público e a lista de IPs permitidos da API." : body.data.error.message,
      error.response?.status, body.data.error.requestId, retryAfterMs(error));
    if (!error.response) return new ApiError("NETWORK_ERROR", "Não foi possível alcançar o servidor.");
    // Resposta sem o corpo de erro do contrato (ex.: 502 do gateway): o status ainda decide se vale tentar de novo.
    return new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.", error.response.status, undefined, retryAfterMs(error));
  }
  return new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.");
}

// A mesma política atende notas, Calendar, biblioteca e finanças, mesmo fora de React Query.
apiClient.interceptors.response.use((response) => response, async (error: unknown) => {
  if (axios.isCancel(error)) throw error;
  const normalized = toApiError(error);
  const config = axios.isAxiosError(error) ? error.config as (NonNullable<typeof error.config> & { readRetries?: number; authEpoch?: number }) | undefined : undefined;
  const current = config?.authEpoch === authEpoch;
  if (normalized.status === 401 && current) unauthorized();
  if (normalized.status === 429 && current) requestBudget.defer(normalized.retryAfterMs ?? 1000);
  const retries = config?.readRetries ?? 0;
  if (config && current && config.method?.toLowerCase() === "get" && retries < 2
    && (normalized.status === 429 || (normalized.status !== undefined && normalized.status >= 500))) {
    config.readRetries = retries + 1;
    requestBudget.defer(Math.max(normalized.retryAfterMs ?? 0, 500 * 2 ** retries + Math.random() * 250));
    return apiClient.request(config);
  }
  throw normalized;
});

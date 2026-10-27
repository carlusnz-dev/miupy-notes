import axios, { AxiosError } from "axios";
import { z } from "zod";
import { apiBaseUrlSchema } from "./api-base-url";

const env = z.object({ VITE_API_BASE_URL: apiBaseUrlSchema.optional() }).parse(import.meta.env);

type AccessTokenProvider = () => Promise<string>;
let accessTokenProvider: AccessTokenProvider | null = null;

/** Definido por `lib/auth.ts` ao entrar (ID token do Google via comando Tauri) e zerado ao sair. */
export function setAccessTokenProvider(provider: AccessTokenProvider | null) {
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
  config.headers.Authorization = `Bearer ${await accessTokenProvider()}`;
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
    if (body.success) return new ApiError(body.data.error.code, body.data.error.message, error.response?.status, body.data.error.requestId, retryAfterMs(error));
    if (!error.response) return new ApiError("NETWORK_ERROR", "Não foi possível alcançar o servidor.");
    // Resposta sem o corpo de erro do contrato (ex.: 502 do gateway): o status ainda decide se vale tentar de novo.
    return new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.", error.response.status, undefined, retryAfterMs(error));
  }
  return new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.");
}

import axios, { AxiosError } from "axios";
import { z } from "zod";

const env = z.object({ VITE_API_BASE_URL: z.url().optional() }).parse(import.meta.env);

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

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AxiosError) {
    const body = errorBodySchema.safeParse(error.response?.data);
    if (body.success) return new ApiError(body.data.error.code, body.data.error.message, error.response?.status, body.data.error.requestId);
    if (!error.response) return new ApiError("NETWORK_ERROR", "Não foi possível alcançar o servidor.");
  }
  return new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.");
}

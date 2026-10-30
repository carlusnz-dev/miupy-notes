import { z } from "zod";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS é obrigatório; HTTP só para a API local em loopback. Qualquer outro host remoto é recusado. */
export const apiBaseUrlSchema = z.url().refine((value) => {
  const { protocol, hostname } = new URL(value);
  return protocol === "https:" || (protocol === "http:" && LOOPBACK_HOSTNAMES.has(hostname));
}, "VITE_API_BASE_URL deve usar HTTPS; HTTP só é aceito para localhost, 127.0.0.1 ou [::1].");

/** Ambiente do cliente: variável vazia (ex.: `vars` ausente na CI) conta como não configurada, sem derrubar o app na carga. */
export const apiEnvSchema = z.object({
  VITE_API_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), apiBaseUrlSchema.optional()),
});

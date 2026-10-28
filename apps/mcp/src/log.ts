// Logs só em stderr: no stdio, stdout pertence ao protocolo. Campos fixos, sem token, corpo ou conteúdo de nota.
export type LogFields = { tool?: string; code?: string; status?: number; durationMs?: number; requestId?: string; port?: number; reason?: string };
export type Logger = (event: string, fields?: LogFields) => void;

export const log: Logger = (event, fields = {}) => {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
};

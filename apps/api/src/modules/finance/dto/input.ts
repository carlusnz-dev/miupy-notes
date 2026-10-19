import { z } from "zod";
import { bankFields, transactionFields } from "../contract.js";

const validTransaction = (data: { direction: string; paymentMethod: string | null; link: string; linkedMonth: string | null }) =>
  (data.direction === "expense" ? data.paymentMethod !== null : data.paymentMethod === null) && (data.link === "none" ? data.linkedMonth === null : data.linkedMonth !== null);
export const createTransactionSchema = z.strictObject(transactionFields).refine(validTransaction, "Confira método de pagamento e mês do vínculo.");
// Atualização completa evita combinações inválidas após um PATCH parcial.
export const updateTransactionSchema = z.strictObject({ ...transactionFields, version: z.int().positive() }).refine(validTransaction);
export const createBankSchema = z.strictObject(bankFields);
export const updateBankSchema = z.strictObject({ ...bankFields, version: z.int().positive() });
export const versionSchema = z.strictObject({ version: z.int().positive() });
export const pageQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(512).optional() });
export type PageQuery = z.infer<typeof pageQuerySchema>;

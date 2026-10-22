import { z } from "zod";

export const installmentCountSchema = z.int().min(1).max(120).nullable();

export const transactionFields = {
  title: z.string().trim().min(1).max(200),
  amountCents: z.int().min(1).max(1_000_000_000_000),
  currency: z.enum(["BRL", "USD", "EUR"]),
  direction: z.enum(["income", "expense"]),
  date: z.iso.date(),
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  bankId: z.uuid().nullable(),
  accountId: z.uuid().nullable().optional(),
  source: z.string().trim().min(1).max(200),
  link: z.enum(["none", "salary", "monthlyBills"]),
  linkedMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
  installmentCount: installmentCountSchema.optional(),
  paymentMethod: z.enum(["pix", "card", "cash", "transfer", "other"]).nullable(),
};
export const logoSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("url"), url: z.url().max(2048).refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && /\.(png|jpe?g|webp)$/i.test(url.pathname);
  }, "Use uma URL HTTP(S) de PNG, JPEG ou WebP.") }),
  z.strictObject({ kind: z.literal("upload"), mime: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(4).max(87_384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }),
]);
export const bankFields = { title: z.string().trim().min(1).max(120), logo: logoSchema.nullable() };
const metadata = { id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.int().positive() };
export const transactionOutputSchema = z.strictObject({ ...transactionFields, accountId: z.uuid().nullable().default(null), installmentCount: installmentCountSchema.default(null), ...metadata, bankTitle: z.string().nullable() });
export const bankOutputSchema = z.strictObject({ ...bankFields, ...metadata });
export const transactionPageSchema = z.strictObject({ items: z.array(transactionOutputSchema), nextCursor: z.string().nullable() });
export const bankPageSchema = z.strictObject({ items: z.array(bankOutputSchema), nextCursor: z.string().nullable() });
export const summarySchema = z.strictObject({ currencies: z.array(z.strictObject({ currency: transactionFields.currency, incomeCents: z.int(), expenseCents: z.int(), balanceCents: z.int(), count: z.int() })) });
export type Transaction = z.infer<typeof transactionOutputSchema>;
export type Bank = z.infer<typeof bankOutputSchema>;
export type TransactionInput = z.infer<typeof transactionFieldsSchema>;
const transactionFieldsSchema = z.strictObject(transactionFields);
export type BankInput = z.infer<typeof bankInputSchema>;
const bankInputSchema = z.strictObject(bankFields);

// Saldo no início de openingDate; movimentos dessa data em diante são somados uma vez.
export const accountFields = {
  title: z.string().trim().min(1).max(120),
  bankId: z.uuid(), currency: transactionFields.currency,
  openingBalanceCents: z.int(), openingDate: z.iso.date(),
};
export const accountOutputSchema = z.strictObject({ ...accountFields, source: z.literal("manual").default("manual"), ...metadata });
export const accountPageSchema = z.strictObject({ items: z.array(accountOutputSchema), nextCursor: z.string().nullable() });
export type Account = z.infer<typeof accountOutputSchema>;
export type AccountInput = z.infer<typeof accountInputSchema>;
const accountInputSchema = z.strictObject(accountFields);
const balanceFields = { currency: transactionFields.currency, balanceCents: z.int() };
export const balancesSchema = z.strictObject({
  calculatedAt: z.iso.datetime(),
  accounts: z.array(z.strictObject({ ...accountFields, source: z.literal("manual"), ...metadata, movementCents: z.int(), balanceCents: z.int() })),
  banks: z.array(z.strictObject({ bankId: z.uuid().nullable(), title: z.string(), currencies: z.array(z.strictObject(balanceFields)) })),
  currencies: z.array(z.strictObject({ ...balanceFields, unallocatedCents: z.int() })),
});
export type Balances = z.infer<typeof balancesSchema>;

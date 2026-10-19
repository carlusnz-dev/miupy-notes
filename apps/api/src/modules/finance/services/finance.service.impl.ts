import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import type { BankInput, TransactionInput } from "../contract.js";
import { FinanceRecord, type RecordData, type RecordKind } from "../domain/finance-record.js";
import type { PageQuery } from "../dto/input.js";
import { FinanceRepository } from "../repository/finance.repository.js";
import { FinanceService } from "./finance.service.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Registro não encontrado.");
const conflict = () => new AppError(409, "CONFLICT", "Registro alterado. Recarregue antes de tentar novamente.");
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function validateLogo(input: BankInput) {
  if (input.logo?.kind !== "upload") return;
  const bytes = Buffer.from(input.logo.base64, "base64");
  const signature = input.logo.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : input.logo.mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (bytes.length > 65_536 || !signature || bytes.toString("base64") !== input.logo.base64) throw new AppError(400, "VALIDATION_ERROR", "Logo inválido. Use PNG, JPEG ou WebP de até 64 KiB.");
}
export class FinanceServiceImpl extends FinanceService {
  constructor(repository: FinanceRepository) { super(repository); }
  list(ownerId: string, kind: RecordKind, query: PageQuery) { return this.repository.list(ownerId, kind, query.limit, query.cursor); }
  async findById(ownerId: string, id: string, kind: RecordKind) {
    const record = await this.repository.findById(ownerId, id, kind);
    if (!record) throw notFound();
    return record;
  }
  private async transactionData(ownerId: string, input: TransactionInput) {
    let bankTitle: string | null = null;
    if (input.bankId) bankTitle = (await this.findById(ownerId, input.bankId, "bank")).data.title;
    return { ...input, installmentCount: input.installmentCount ?? null, bankTitle };
  }
  async create(ownerId: string, kind: RecordKind, input: TransactionInput | BankInput) {
    const now = new Date().toISOString();
    const metadata = { id: randomUUID(), createdAt: now, updatedAt: now, version: 1 };
    let data: RecordData;
    if (kind === "bank") { validateLogo(input as BankInput); data = { kind, ...input as BankInput, ...metadata }; }
    else data = { kind, ...await this.transactionData(ownerId, input as TransactionInput), ...metadata };
    return this.repository.create(new FinanceRecord(ownerId, data));
  }
  async update(ownerId: string, id: string, kind: RecordKind, input: (TransactionInput | BankInput) & { version: number }) {
    const current = await this.findById(ownerId, id, kind);
    if (current.version !== input.version) throw conflict();
    const metadata = { id, createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version + 1 };
    let data: RecordData;
    if (kind === "bank") { validateLogo(input as BankInput); data = { kind, ...input as BankInput, ...metadata }; }
    else {
      const transaction = input as TransactionInput;
      // Banco removido permanece como fotografia histórica quando o vínculo não muda.
      const bankTitle = current.data.kind === "transaction" && current.data.bankId === transaction.bankId ? current.data.bankTitle : (await this.transactionData(ownerId, transaction)).bankTitle;
      const isCard = transaction.direction === "expense" && transaction.paymentMethod === "card";
      const previousCount = current.data.kind === "transaction" ? current.data.installmentCount ?? null : null;
      const installmentCount = transaction.installmentCount !== undefined
        ? transaction.installmentCount : isCard ? previousCount : null;
      data = { kind, ...transaction, installmentCount, bankTitle, ...metadata };
    }
    const record = new FinanceRecord(ownerId, data);
    if (!await this.repository.update(record, input.version)) throw conflict();
    return record;
  }
  async delete(ownerId: string, id: string, kind: RecordKind, version: number) {
    const current = await this.findById(ownerId, id, kind);
    if (current.version !== version || !await this.repository.delete(ownerId, id, kind, version)) throw conflict();
  }
  async *allTransactions(ownerId: string) {
    let cursor: string | undefined;
    do {
      const page = await this.repository.list(ownerId, "transaction", 50, cursor);
      for (const record of page.items) if (record.data.kind === "transaction") yield record.data;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  async summary(ownerId: string) {
    const totals = new Map<string, { currency: string; incomeCents: number; expenseCents: number; balanceCents: number; count: number }>();
    for await (const item of this.allTransactions(ownerId)) {
      const total = totals.get(item.currency) ?? { currency: item.currency, incomeCents: 0, expenseCents: 0, balanceCents: 0, count: 0 };
      total[item.direction === "income" ? "incomeCents" : "expenseCents"] += item.amountCents;
      total.balanceCents = total.incomeCents - total.expenseCents;
      total.count++;
      if (![total.incomeCents, total.expenseCents, total.balanceCents].every(Number.isSafeInteger)) throw new AppError(422, "TOTAL_OVERFLOW", "Total fora do limite de precisão.");
      totals.set(item.currency, total);
    }
    return { currencies: [...totals.values()] };
  }
  async *csv(ownerId: string) {
    yield "\uFEFF" + ["ID", "Título", "Valor (centavos)", "Moeda", "Entrada/saída", "Data", "Categoria", "Banco", "Tags", "Origem", "Vínculo", "Mês", "Método", "Parcelas"].map(csvCell).join(",") + "\r\n";
    for await (const t of this.allTransactions(ownerId)) yield [t.id,t.title,t.amountCents,t.currency,t.direction,t.date,t.category,t.bankTitle,t.tags.join("; "),t.source,t.link,t.linkedMonth,t.paymentMethod,t.installmentCount].map(csvCell).join(",") + "\r\n";
  }
}

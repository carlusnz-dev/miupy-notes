import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import type { AccountInput, Balances, BankInput, TransactionInput } from "../contract.js";
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
    if (input.accountId) {
      const account = (await this.findById(ownerId, input.accountId, "account")).data;
      if (account.kind !== "account" || account.currency !== input.currency || account.bankId !== input.bankId)
        throw new AppError(400, "VALIDATION_ERROR", "Conta, instituição e moeda devem corresponder.");
    }
    let bankTitle: string | null = null;
    if (input.bankId) bankTitle = (await this.findById(ownerId, input.bankId, "bank")).data.title;
    return { ...input, accountId: input.accountId ?? null, installmentCount: input.installmentCount ?? null, bankTitle };
  }
  async create(ownerId: string, kind: RecordKind, input: TransactionInput | BankInput | AccountInput) {
    const now = new Date().toISOString();
    const metadata = { id: randomUUID(), createdAt: now, updatedAt: now, version: 1 };
    let data: RecordData;
    if (kind === "account") {
      const account = input as AccountInput;
      await this.findById(ownerId, account.bankId, "bank");
      data = { kind, ...account, source: "manual", ...metadata };
    }
    else if (kind === "bank") { validateLogo(input as BankInput); data = { kind, ...input as BankInput, ...metadata }; }
    else data = { kind, ...await this.transactionData(ownerId, input as TransactionInput), ...metadata };
    return this.repository.create(new FinanceRecord(ownerId, data));
  }
  async update(ownerId: string, id: string, kind: RecordKind, input: (TransactionInput | BankInput | AccountInput) & { version: number }) {
    const current = await this.findById(ownerId, id, kind);
    if (current.version !== input.version) throw conflict();
    const metadata = { id, createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version + 1 };
    let data: RecordData;
    if (kind === "account") {
      const account = input as AccountInput;
      if (current.data.kind !== "account" || account.bankId !== current.data.bankId || account.currency !== current.data.currency)
        throw new AppError(400, "VALIDATION_ERROR", "Instituição e moeda da conta não podem mudar. Crie outra conta.");
      data = { kind, ...account, source: "manual", ...metadata };
    }
    else if (kind === "bank") { validateLogo(input as BankInput); data = { kind, ...input as BankInput, ...metadata }; }
    else {
      const provided = input as TransactionInput;
      const accountId = provided.accountId !== undefined ? provided.accountId
        : current.data.kind === "transaction" && current.data.bankId === provided.bankId ? current.data.accountId ?? null : null;
      const transaction = { ...provided, accountId };
      if (accountId) await this.transactionData(ownerId, transaction);
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
    if (kind === "account") throw new AppError(400, "VALIDATION_ERROR", "Exclusão de contas indisponível.");
    const current = await this.findById(ownerId, id, kind);
    if (kind === "bank") {
      for await (const account of this.allRecords(ownerId, "account")) {
        if (account.data.kind === "account" && account.data.bankId === id) throw new AppError(409, "CONFLICT", "A instituição possui contas e deve ser preservada.");
      }
    }
    if (current.version !== version || !await this.repository.delete(ownerId, id, kind, version)) throw conflict();
  }
  private async *allRecords(ownerId: string, kind: RecordKind) {
    let cursor: string | undefined;
    do {
      const page = await this.repository.list(ownerId, kind, 50, cursor);
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  async *allTransactions(ownerId: string) {
    for await (const record of this.allRecords(ownerId, "transaction")) if (record.data.kind === "transaction") yield record.data;
  }
  async balances(ownerId: string): Promise<Balances> {
    const add = (a: number, b: number) => {
      const total = a + b;
      if (!Number.isSafeInteger(total)) throw new AppError(422, "TOTAL_OVERFLOW", "Total fora do limite de precisão.");
      return total;
    };
    const accounts: Balances["accounts"] = [];
    for await (const record of this.allRecords(ownerId, "account")) if (record.data.kind === "account") {
      const { kind: _, ...account } = record.data;
      accounts.push({ ...account, movementCents: 0, balanceCents: account.openingBalanceCents });
    }
    const byAccount = new Map(accounts.map(a => [a.id, a]));
    const institutions = new Map<string | null, Balances["banks"][number]>();
    for await (const record of this.allRecords(ownerId, "bank")) if (record.data.kind === "bank")
      institutions.set(record.id, { bankId: record.id, title: record.data.title, currencies: [] });
    const currencies = new Map<string, Balances["currencies"][number]>();
    const accumulate = (bankId: string | null, title: string, currency: AccountInput["currency"], amount: number, unallocated: boolean) => {
      const bank = institutions.get(bankId) ?? { bankId, title, currencies: [] };
      const bankTotal = bank.currencies.find(t => t.currency === currency) ?? { currency, balanceCents: 0 };
      if (!bank.currencies.includes(bankTotal)) bank.currencies.push(bankTotal);
      bankTotal.balanceCents = add(bankTotal.balanceCents, amount);
      institutions.set(bankId, bank);
      const total = currencies.get(currency) ?? { currency, balanceCents: 0, unallocatedCents: 0 };
      total.balanceCents = add(total.balanceCents, amount);
      if (unallocated) total.unallocatedCents = add(total.unallocatedCents, amount);
      currencies.set(currency, total);
    };
    for await (const item of this.allTransactions(ownerId)) {
      const amount = item.direction === "income" ? item.amountCents : -item.amountCents;
      const account = item.accountId ? byAccount.get(item.accountId) : undefined;
      if (item.accountId && (!account || account.currency !== item.currency || account.bankId !== item.bankId))
        throw new AppError(409, "CONFLICT", "Vínculo de conta inconsistente. Revise os lançamentos.");
      if (account) {
        if (item.date >= account.openingDate) {
          account.movementCents = add(account.movementCents, amount);
          account.balanceCents = add(account.balanceCents, amount);
        }
      } else accumulate(item.bankId, item.bankTitle ?? "Sem instituição", item.currency, amount, true);
    }
    for (const account of accounts) accumulate(account.bankId, "Instituição removida", account.currency, account.balanceCents, false);
    return { calculatedAt: new Date().toISOString(), accounts, banks: [...institutions.values()], currencies: [...currencies.values()] };
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

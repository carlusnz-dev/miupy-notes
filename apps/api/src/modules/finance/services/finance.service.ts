import { BaseService } from "../../../core/services/base.service.js";
import type { AccountInput, Balances, BankInput, TransactionInput } from "../contract.js";
import { FinanceRecord, type RecordKind } from "../domain/finance-record.js";
import type { PageQuery } from "../dto/input.js";
import { FinanceRepository, type FinancePage } from "../repository/finance.repository.js";
export abstract class FinanceService extends BaseService<FinanceRecord, FinanceRepository> {
  abstract list(ownerId: string, kind: RecordKind, query: PageQuery): Promise<FinancePage>;
  abstract findById(ownerId: string, id: string, kind: RecordKind): Promise<FinanceRecord>;
  abstract create(ownerId: string, kind: RecordKind, input: TransactionInput | BankInput | AccountInput): Promise<FinanceRecord>;
  abstract update(ownerId: string, id: string, kind: RecordKind, input: (TransactionInput | BankInput | AccountInput) & { version: number }): Promise<FinanceRecord>;
  abstract delete(ownerId: string, id: string, kind: RecordKind, version: number): Promise<void>;
  abstract summary(ownerId: string): Promise<{ currencies: Array<{ currency: string; incomeCents: number; expenseCents: number; balanceCents: number; count: number }> }>;
  abstract balances(ownerId: string): Promise<Balances>;
  abstract csv(ownerId: string): AsyncIterable<string>;
}

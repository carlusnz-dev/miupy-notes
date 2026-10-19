import { BaseRepository } from "../../../core/repository/base.repository.js";
import { FinanceRecord, type RecordKind } from "../domain/finance-record.js";
export type FinancePage = { items: FinanceRecord[]; nextCursor: string | null };
export abstract class FinanceRepository extends BaseRepository<FinanceRecord> {
  abstract findById(ownerId: string, id: string, kind?: RecordKind): Promise<FinanceRecord | null>;
  abstract list(ownerId: string, kind: RecordKind, limit: number, cursor?: string): Promise<FinancePage>;
  abstract update(record: FinanceRecord, expectedVersion: number): Promise<boolean>;
  abstract delete(ownerId: string, id: string, kind: RecordKind, expectedVersion: number): Promise<boolean>;
}

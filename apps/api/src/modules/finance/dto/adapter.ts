import type { FinanceRecord } from "../domain/finance-record.js";
export function toOutput(record: FinanceRecord) {
  const { kind: _kind, ...data } = record.data;
  return data;
}

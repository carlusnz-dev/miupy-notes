import { OwnedEntity } from "../../../core/domain/owned-entity.js";
import type { Bank, Transaction } from "../contract.js";

export type RecordData = ({ kind: "transaction" } & Transaction) | ({ kind: "bank" } & Bank);
export class FinanceRecord extends OwnedEntity {
  constructor(public readonly ownerId: string, public readonly data: RecordData) { super(); }
  get id() { return this.data.id; }
  get version() { return this.data.version; }
  get createdAt() { return this.data.createdAt; }
  get updatedAt() { return this.data.updatedAt; }
}
export type RecordKind = RecordData["kind"];

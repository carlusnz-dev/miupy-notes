import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import { accountOutputSchema, bankOutputSchema, transactionOutputSchema } from "../contract.js";
import { FinanceRecord, type RecordKind } from "../domain/finance-record.js";
import { FinanceRepository, type FinancePage } from "./finance.repository.js";

const key = (ownerId: string, id: string, kind: RecordKind) => ({ pk: `USER#${ownerId}`, sk: `FINANCE#${kind}#${id}` });
function cursorId(cursor: string): string {
  try { return z.strictObject({ id: z.uuid() }).parse(JSON.parse(Buffer.from(cursor, "base64url").toString())).id; }
  catch { throw new AppError(400, "VALIDATION_ERROR", "Cursor inválido."); }
}
function read(ownerId: string, kind: RecordKind, item: Record<string, unknown>): FinanceRecord {
  const { pk: _pk, sk: _sk, ownerId: _owner, kind: _kind, ...data } = item;
  return new FinanceRecord(ownerId, kind === "account" ? { kind, ...accountOutputSchema.parse(data) } : kind === "bank" ? { kind, ...bankOutputSchema.parse(data) } : { kind, ...transactionOutputSchema.parse(data) });
}
export class DynamoFinanceRepository extends FinanceRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) { super(); }
  async create(record: FinanceRecord) {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...key(record.ownerId, record.id, record.data.kind), ownerId: record.ownerId, ...record.data }, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
    return record;
  }
  async findById(ownerId: string, id: string, kind: RecordKind = "transaction") {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key(ownerId, id, kind), ConsistentRead: true }));
    return result.Item ? read(ownerId, kind, result.Item) : null;
  }
  async list(ownerId: string, kind: RecordKind, limit: number, cursor?: string): Promise<FinancePage> {
    const result = await this.client.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `USER#${ownerId}`, ":prefix": `FINANCE#${kind}#` },
      Limit: limit, ConsistentRead: true, ExclusiveStartKey: cursor ? key(ownerId, cursorId(cursor), kind) : undefined,
    }));
    const last = result.LastEvaluatedKey?.sk;
    const id = typeof last === "string" ? last.split("#").at(-1) : undefined;
    return { items: (result.Items ?? []).map(item => read(ownerId, kind, item)), nextCursor: id ? Buffer.from(JSON.stringify({ id })).toString("base64url") : null };
  }
  private async conditional(send: () => Promise<unknown>): Promise<boolean> {
    try { await send(); return true; }
    catch (error) { if (error instanceof ConditionalCheckFailedException) return false; throw error; }
  }
  update(record: FinanceRecord, expectedVersion: number) {
    return this.conditional(() => this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...key(record.ownerId, record.id, record.data.kind), ownerId: record.ownerId, ...record.data },
      ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": expectedVersion } })));
  }
  delete(ownerId: string, id: string, kind: RecordKind, expectedVersion: number) {
    return this.conditional(() => this.client.send(new DeleteCommand({ TableName: this.tableName, Key: key(ownerId, id, kind), ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": expectedVersion } })));
  }
}

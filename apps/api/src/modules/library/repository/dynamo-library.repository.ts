import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { LibraryItem } from "../domain/library-item.js";
import type { ListLibraryQuery } from "../dto/input.js";
import { libraryItemOutputSchema } from "../dto/output.js";
import { LibraryRepository, type LibraryPage } from "./library.repository.js";
import { decodeCursor, encodeCursor, matches } from "./pagination.js";

const keyOf = (ownerId: string, id: string) => ({ pk: `USER#${ownerId}`, sk: `LIBRARY#${id}` });
const storedSchema = libraryItemOutputSchema.extend({ ownerId: z.string() });
function fromStored(raw: Record<string, unknown>) { const data = storedSchema.parse(raw); return new LibraryItem(data.ownerId, data); }

export class DynamoLibraryRepository extends LibraryRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) { super(); }
  async create(item: LibraryItem) {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...keyOf(item.ownerId, item.id), ...item }, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
    return item;
  }
  async findById(ownerId: string, id: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: keyOf(ownerId, id), ConsistentRead: true }));
    return result.Item ? fromStored(result.Item) : null;
  }
  async list(ownerId: string, query: ListLibraryQuery): Promise<LibraryPage> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${ownerId}`, ":prefix": "LIBRARY#" }, Limit: query.limit,
      ExclusiveStartKey: query.cursor ? keyOf(ownerId, decodeCursor(query.cursor)) : undefined,
    }));
    // O cursor avança pelos itens avaliados, inclusive quando os filtros deixam a página vazia.
    const last = result.LastEvaluatedKey;
    const id = last ? z.uuid().parse(String(last.sk).replace(/^LIBRARY#/, "")) : null;
    return { items: (result.Items ?? []).map(fromStored).filter(item => matches(item, query)), nextCursor: id ? encodeCursor(id) : null };
  }
  async update(item: LibraryItem, expectedVersion: number) {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...keyOf(item.ownerId, item.id), ...item },
        ConditionExpression: "#version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion } }));
      return item;
    } catch (error) { if (error instanceof ConditionalCheckFailedException) return null; throw error; }
  }
  async delete(ownerId: string, id: string) {
    try {
      await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: keyOf(ownerId, id), ConditionExpression: "attribute_exists(pk)" })); return true;
    } catch (error) { if (error instanceof ConditionalCheckFailedException) return false; throw error; }
  }
}

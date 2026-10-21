import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { Folder } from "../domain/folder.js";
import { FoldersRepository } from "./folders.repository.js";

const storedFolderSchema = z.object({
  id: z.uuid(),
  ownerId: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

function toFolder(item: Record<string, unknown>): Folder {
  const data = storedFolderSchema.parse(item);
  return new Folder(data.id, data.ownerId, data.name, data.parentId, data.createdAt, data.updatedAt, data.version);
}

// Mesma tabela das notas: o prefixo FOLDER# mantém pastas fora da consulta `NOTE#` e o `pk` do proprietário as isola.
function keyOf(ownerId: string, id: string) {
  return { pk: `USER#${ownerId}`, sk: `FOLDER#${id}` };
}

export class DynamoFoldersRepository extends FoldersRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) { super(); }

  async create(folder: Folder): Promise<Folder> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...keyOf(folder.ownerId, folder.id), ...folder },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }));
    return folder;
  }

  async findById(ownerId: string, id: string): Promise<Folder | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: keyOf(ownerId, id) }));
    return result.Item ? toFolder(result.Item) : null;
  }

  async listAll(ownerId: string): Promise<Folder[]> {
    const folders: Folder[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `USER#${ownerId}`, ":prefix": "FOLDER#" },
        ExclusiveStartKey: start,
      }));
      folders.push(...(result.Items ?? []).map(toFolder));
      start = result.LastEvaluatedKey;
    } while (start);
    return folders;
  }

  async update(folder: Folder, expectedVersion: number): Promise<Folder | null> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { ...keyOf(folder.ownerId, folder.id), ...folder },
        ConditionExpression: "#version = :expected",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return folder;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

}

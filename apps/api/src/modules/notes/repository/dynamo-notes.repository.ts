import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import { Note } from "../domain/note.js";
import { NotesRepository, type NotePage } from "./notes.repository.js";

const storedNoteSchema = z.object({
  id: z.uuid(),
  ownerId: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  // Notas gravadas antes das pastas não têm o atributo: ficam na raiz.
  folderId: z.uuid().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

const cursorSchema = z.strictObject({ id: z.uuid() });

function toNote(item: Record<string, unknown>): Note {
  const data = storedNoteSchema.parse(item);
  return new Note(data.id, data.ownerId, data.title, data.body, data.tags, data.folderId, data.createdAt, data.updatedAt, data.version);
}

function keyOf(ownerId: string, id: string) {
  return { pk: `USER#${ownerId}`, sk: `NOTE#${id}` };
}

// O cursor carrega só o ID da última nota; a partição sempre vem do proprietário autenticado,
// então um cursor forjado não alcança notas de outro usuário.
function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id })).toString("base64url");
}

function decodeCursor(cursor: string): string {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).id;
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Cursor inválido.");
  }
}

export class DynamoNotesRepository extends NotesRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) { super(); }

  async create(note: Note): Promise<Note> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...keyOf(note.ownerId, note.id), ...note },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }));
    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: keyOf(ownerId, id) }));
    return result.Item ? toNote(result.Item) : null;
  }

  async list(ownerId: string, limit: number, cursor?: string): Promise<NotePage> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${ownerId}`, ":prefix": "NOTE#" },
      Limit: limit,
      ExclusiveStartKey: cursor ? keyOf(ownerId, decodeCursor(cursor)) : undefined,
    }));
    const items = (result.Items ?? []).map(toNote);
    const lastId = result.LastEvaluatedKey ? items.at(-1)?.id : undefined;
    return { items, nextCursor: lastId ? encodeCursor(lastId) : null };
  }

  async update(note: Note, expectedVersion: number): Promise<Note | null> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { ...keyOf(note.ownerId, note.id), ...note },
        ConditionExpression: "#version = :expected",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return note;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: keyOf(ownerId, id),
        ConditionExpression: "attribute_exists(pk)",
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}

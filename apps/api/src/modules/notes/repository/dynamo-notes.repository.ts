import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { Note } from "../domain/note.js";
import { NotesRepository } from "./notes.repository.js";

const storedNoteSchema = z.object({
  id: z.uuid(),
  ownerId: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export class DynamoNotesRepository extends NotesRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) { super(); }

  async create(note: Note): Promise<Note> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: `USER#${note.ownerId}`, sk: `NOTE#${note.id}`, ...note },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }));
    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `USER#${ownerId}`, sk: `NOTE#${id}` },
    }));
    if (!result.Item) return null;
    const data = storedNoteSchema.parse(result.Item);
    return new Note(data.id, data.ownerId, data.title, data.body, data.tags, data.createdAt, data.updatedAt, data.version);
  }
}

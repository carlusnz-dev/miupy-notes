import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import { CalendarTask } from "../domain/calendar-task.js";
import type { DeleteResult } from "./calendar.repository.js";
import { TaskRepository, type TaskPage, type TaskQuery } from "./task.repository.js";

const storedTaskSchema = z.object({
  id: z.uuid(), ownerId: z.string(), title: z.string(), description: z.string(),
  dueDate: z.string().nullable(), dueTime: z.string().nullable(), status: z.enum(["pending", "completed"]), completedAt: z.string().nullable(),
  external: z.object({ provider: z.literal("google"), taskListId: z.string(), taskId: z.string(), syncedAt: z.string() }).nullable().default(null),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.int().positive(),
});
const cursorSchema = z.strictObject({ id: z.uuid() });

const TASK_PREFIX = "TASK#";
/** Com filtro de status o DynamoDB aplica `Limit` antes do filtro: o repositório continua lendo até juntar a página. */
const SCAN_PAGE = 100;
const MAX_QUERIES = 5;

const ownerKey = (ownerId: string) => `USER#${ownerId}`;
const taskKey = (ownerId: string, id: string) => ({ pk: ownerKey(ownerId), sk: `${TASK_PREFIX}${id}` });
const toTask = (item: Record<string, unknown>): CalendarTask => {
  const d = storedTaskSchema.parse(item);
  return new CalendarTask(d.id, d.ownerId, d.title, d.description, d.dueDate, d.dueTime, d.status, d.completedAt, d.external, d.createdAt, d.updatedAt, d.version);
};
const toItem = (task: CalendarTask) => ({ ...taskKey(task.ownerId, task.id), ...task });

const encodeCursor = (id: string) => Buffer.from(JSON.stringify({ id })).toString("base64url");
function decodeCursor(cursor: string): string {
  try { return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).id; }
  catch { throw new AppError(400, "VALIDATION_ERROR", "Cursor inválido."); }
}
const idOfKey = (key: Record<string, unknown> | undefined) => (typeof key?.sk === "string" ? key.sk.slice(TASK_PREFIX.length) : undefined);

export class DynamoTaskRepository extends TaskRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) { super(); }

  async create(task: CalendarTask): Promise<CalendarTask> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: toItem(task), ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new AppError(409, "CONFLICT", "Já existe uma tarefa com este identificador.");
      throw error;
    }
    return task;
  }

  async findById(ownerId: string, id: string): Promise<CalendarTask | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: taskKey(ownerId, id), ConsistentRead: true }));
    return result.Item ? toTask(result.Item) : null;
  }

  async list(ownerId: string, query: TaskQuery): Promise<TaskPage> {
    const filtered = query.status !== undefined;
    const values: Record<string, unknown> = { ":pk": ownerKey(ownerId), ":prefix": TASK_PREFIX, ...(filtered ? { ":status": query.status } : {}) };
    let startKey = query.cursor ? taskKey(ownerId, decodeCursor(query.cursor)) : undefined;
    const items: CalendarTask[] = [];
    let more = true;
    for (let round = 0; more && items.length < query.limit && round < (filtered ? MAX_QUERIES : 1); round++) {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        FilterExpression: filtered ? "#status = :status" : undefined,
        ExpressionAttributeNames: filtered ? { "#status": "status" } : undefined,
        ExpressionAttributeValues: values,
        Limit: filtered ? SCAN_PAGE : query.limit,
        ExclusiveStartKey: startKey,
      }));
      items.push(...(result.Items ?? []).map(toTask));
      startKey = result.LastEvaluatedKey as typeof startKey;
      more = startKey !== undefined;
    }
    // Excedente da última leitura volta para a próxima página: o cursor é o último item devolvido.
    const page = items.slice(0, query.limit);
    const trimmed = items.length > page.length;
    const lastId = trimmed ? page.at(-1)?.id : more ? idOfKey(startKey) : undefined;
    return { items: page, nextCursor: lastId ? encodeCursor(lastId) : null };
  }

  async update(task: CalendarTask, expectedVersion: number): Promise<CalendarTask | null> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName, Item: toItem(task),
        ConditionExpression: "#version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return task;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  async delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName, Key: taskKey(ownerId, id),
        ConditionExpression: "attribute_exists(pk) AND #version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return "deleted";
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      return (await this.findById(ownerId, id)) ? "conflict" : "missing";
    }
  }
}

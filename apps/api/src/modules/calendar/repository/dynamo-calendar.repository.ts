import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AppError } from "../../../core/domain/app-error.js";
import { CalendarEvent } from "../domain/calendar-event.js";
import { eventBounds } from "../domain/event-time.js";
import type { GoogleConnection, PendingAuthorization } from "../domain/google-connection.js";
import { CalendarRepository, type DeleteResult, type EventPage, type EventQuery } from "./calendar.repository.js";

const link = z.object({ kind: z.enum(["note", "event"]), id: z.uuid() });
const storedEventSchema = z.object({
  id: z.uuid(), ownerId: z.string(), title: z.string(), description: z.string(), location: z.string(),
  allDay: z.boolean(), start: z.string(), end: z.string(), timeZone: z.string().nullable(),
  links: z.array(link), source: z.enum(["local", "google"]),
  external: z.object({ provider: z.literal("google"), calendarId: z.string(), externalId: z.string(), etag: z.string(), syncedAt: z.string() }).nullable().default(null),
  reflection: z.object({ googleEventId: z.string(), calendarId: z.string(), etag: z.string(), reflectedVersion: z.int().positive(), reflectedAt: z.string() }).nullable().default(null),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.int().positive(),
});
const connectionSchema = z.object({
  status: z.enum(["connected", "needs_reauth"]), mode: z.enum(["mirror", "reflect"]), scopes: z.array(z.string()), calendarId: z.string(),
  connectedAt: z.string(), syncToken: z.string().nullable(), lastSyncAt: z.string().nullable(), lastError: z.string().nullable(),
});
const pendingSchema = z.object({ state: z.string(), mode: z.enum(["mirror", "reflect"]), redirectUri: z.string(), expiresAt: z.string() });
const cursorSchema = z.strictObject({ id: z.uuid() });

const EVENT_PREFIX = "EVENT#";
const CONNECTION_SK = "CALENDAR#GOOGLE";
const PENDING_SK = "CALENDAR#GOOGLE#PENDING";
/** Com filtro de período o DynamoDB aplica `Limit` antes do filtro: o repositório continua lendo até juntar a página. */
const SCAN_PAGE = 100;
const MAX_QUERIES = 5;

const ownerKey = (ownerId: string) => `USER#${ownerId}`;
const eventKey = (ownerId: string, id: string) => ({ pk: ownerKey(ownerId), sk: `${EVENT_PREFIX}${id}` });
const toEvent = (item: Record<string, unknown>): CalendarEvent => {
  const d = storedEventSchema.parse(item);
  return new CalendarEvent(d.id, d.ownerId, d.title, d.description, d.location, d.allDay, d.start, d.end, d.timeZone, d.links, d.source, d.external, d.reflection, d.createdAt, d.updatedAt, d.version);
};
// `startsAt`/`endsAt` são atributos derivados só para o filtro de período; não fazem parte da entidade.
const toItem = (event: CalendarEvent) => ({ ...eventKey(event.ownerId, event.id), ...event, ...eventBounds(event) });

const encodeCursor = (id: string) => Buffer.from(JSON.stringify({ id })).toString("base64url");
function decodeCursor(cursor: string): string {
  try { return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).id; }
  catch { throw new AppError(400, "VALIDATION_ERROR", "Cursor inválido."); }
}
const idOfKey = (key: Record<string, unknown> | undefined) => (typeof key?.sk === "string" ? key.sk.slice(EVENT_PREFIX.length) : undefined);

export class DynamoCalendarRepository extends CalendarRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) { super(); }

  async create(event: CalendarEvent): Promise<CalendarEvent> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: toItem(event), ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new AppError(409, "CONFLICT", "Já existe um evento com este identificador.");
      throw error;
    }
    return event;
  }

  async findById(ownerId: string, id: string): Promise<CalendarEvent | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: eventKey(ownerId, id), ConsistentRead: true }));
    return result.Item ? toEvent(result.Item) : null;
  }

  async list(ownerId: string, query: EventQuery): Promise<EventPage> {
    const filters: string[] = [];
    const values: Record<string, unknown> = { ":pk": ownerKey(ownerId), ":prefix": EVENT_PREFIX };
    if (query.to !== undefined) { filters.push("startsAt < :to"); values[":to"] = query.to; }
    if (query.from !== undefined) { filters.push("endsAt > :from"); values[":from"] = query.from; }
    const filtered = filters.length > 0;
    let startKey = query.cursor ? eventKey(ownerId, decodeCursor(query.cursor)) : undefined;
    const items: CalendarEvent[] = [];
    let more = true;
    for (let round = 0; more && items.length < query.limit && round < (filtered ? MAX_QUERIES : 1); round++) {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        FilterExpression: filtered ? filters.join(" AND ") : undefined,
        ExpressionAttributeValues: values,
        Limit: filtered ? SCAN_PAGE : query.limit,
        ExclusiveStartKey: startKey,
      }));
      items.push(...(result.Items ?? []).map(toEvent));
      startKey = result.LastEvaluatedKey as typeof startKey;
      more = startKey !== undefined;
    }
    // Excedente da última leitura volta para a próxima página: o cursor é o último item devolvido.
    const page = items.slice(0, query.limit);
    const trimmed = items.length > page.length;
    const lastId = trimmed ? page.at(-1)?.id : more ? idOfKey(startKey) : undefined;
    return { items: page, nextCursor: lastId ? encodeCursor(lastId) : null };
  }

  async update(event: CalendarEvent, expectedVersion: number): Promise<CalendarEvent | null> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName, Item: toItem(event),
        ConditionExpression: "#version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return event;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  async delete(ownerId: string, id: string, expectedVersion: number): Promise<DeleteResult> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName, Key: eventKey(ownerId, id),
        ConditionExpression: "attribute_exists(pk) AND #version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion },
      }));
      return "deleted";
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      // A condição não diz o motivo: uma leitura decide entre ausente e versão divergente.
      return (await this.findById(ownerId, id)) ? "conflict" : "missing";
    }
  }

  async upsertMirror(event: CalendarEvent): Promise<void> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName, Item: toItem(event),
        ConditionExpression: "attribute_not_exists(pk) OR #source = :google", ExpressionAttributeNames: { "#source": "source" }, ExpressionAttributeValues: { ":google": "google" },
      }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new AppError(409, "CONFLICT", "Identificador ocupado por evento local.");
      throw error;
    }
  }

  async deleteMirror(ownerId: string, id: string): Promise<boolean> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName, Key: eventKey(ownerId, id),
        ConditionExpression: "#source = :google", ExpressionAttributeNames: { "#source": "source" }, ExpressionAttributeValues: { ":google": "google" },
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async deleteAllMirrors(ownerId: string): Promise<number> {
    let removed = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        FilterExpression: "#source = :google",
        ProjectionExpression: "id",
        ExpressionAttributeNames: { "#source": "source" },
        ExpressionAttributeValues: { ":pk": ownerKey(ownerId), ":prefix": EVENT_PREFIX, ":google": "google" },
        ExclusiveStartKey: startKey,
      }));
      for (const item of result.Items ?? []) if (await this.deleteMirror(ownerId, String(item.id))) removed++;
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return removed;
  }

  async getConnection(ownerId: string): Promise<GoogleConnection | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk: ownerKey(ownerId), sk: CONNECTION_SK }, ConsistentRead: true }));
    return result.Item ? connectionSchema.parse(result.Item) : null;
  }
  async saveConnection(ownerId: string, connection: GoogleConnection): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { pk: ownerKey(ownerId), sk: CONNECTION_SK, ...connection } }));
  }
  async deleteConnection(ownerId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: ownerKey(ownerId), sk: CONNECTION_SK } }));
  }
  async getPending(ownerId: string): Promise<PendingAuthorization | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk: ownerKey(ownerId), sk: PENDING_SK }, ConsistentRead: true }));
    return result.Item ? pendingSchema.parse(result.Item) : null;
  }
  async savePending(ownerId: string, pending: PendingAuthorization): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { pk: ownerKey(ownerId), sk: PENDING_SK, ...pending } }));
  }
  async clearPending(ownerId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: ownerKey(ownerId), sk: PENDING_SK } }));
  }
}

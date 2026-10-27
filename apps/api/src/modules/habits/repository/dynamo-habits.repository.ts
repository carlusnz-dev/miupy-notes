import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { Habit, type HabitLog } from "../domain/habit.js";
import { xpEventKey, type XpEvent } from "../domain/xp.js";
import { habitFields } from "../dto/input.js";
import { habitOutputSchema } from "../dto/output.js";
import { HabitsRepository } from "./habits.repository.js";

const ownerKey = (ownerId: string) => `USER#${ownerId}`;
const habitKey = (ownerId: string, id: string) => ({ pk: ownerKey(ownerId), sk: `HABIT#${id}` });
const logKey = (ownerId: string, habitId: string, date: string) => ({ pk: ownerKey(ownerId), sk: `HLOG#${date}#${habitId}` });
const xpKey = (ownerId: string, habitId: string, date: string, type: XpEvent["type"]) => ({ pk: ownerKey(ownerId), sk: `HXP#${xpEventKey(habitId, date, type)}` });

const storedHabit = habitOutputSchema.extend({ ownerId: z.string() });
const storedLog = z.object({
  ownerId: z.string(), habitId: z.uuid(), date: z.iso.date(), completedAt: z.iso.datetime(),
  title: z.string(), kind: habitFields.kind, priority: habitFields.priority,
});
const storedEvent = z.object({
  habitId: z.uuid(), date: z.iso.date(), type: z.literal("completion"), points: z.int().positive(),
  createdAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(),
});
const toHabit = (raw: Record<string, unknown>) => { const data = storedHabit.parse(raw); return new Habit(data.ownerId, data); };
const toLog = (raw: Record<string, unknown>): HabitLog => storedLog.parse(raw);
const toEvent = (raw: Record<string, unknown>): XpEvent => storedEvent.parse(raw);

export class DynamoHabitsRepository extends HabitsRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) { super(); }

  /** Lê todas as páginas de uma consulta por faixa de `sk` do proprietário; sem Scan. */
  private async queryAll(ownerId: string, condition: string, values: Record<string, string>) {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName, KeyConditionExpression: `pk = :pk AND ${condition}`,
        ExpressionAttributeValues: { ":pk": ownerKey(ownerId), ...values }, ExclusiveStartKey: startKey,
      }));
      items.push(...(result.Items ?? [])); startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async create(habit: Habit) {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...habitKey(habit.ownerId, habit.id), ...habit }, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
    return habit;
  }
  async findById(ownerId: string, id: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: habitKey(ownerId, id), ConsistentRead: true }));
    return result.Item ? toHabit(result.Item) : null;
  }
  async list(ownerId: string) { return (await this.queryAll(ownerId, "begins_with(sk, :p)", { ":p": "HABIT#" })).map(toHabit); }
  async update(habit: Habit, expectedVersion: number) {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...habitKey(habit.ownerId, habit.id), ...habit },
        ConditionExpression: "#version = :expected", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": expectedVersion } }));
      return habit;
    } catch (error) { if (error instanceof ConditionalCheckFailedException) return null; throw error; }
  }
  async deleteHabit(ownerId: string, id: string) {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: habitKey(ownerId, id) }));
  }

  async putLog(log: HabitLog) {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...logKey(log.ownerId, log.habitId, log.date), ...log } }));
  }
  async deleteLog(ownerId: string, habitId: string, date: string) {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: logKey(ownerId, habitId, date) }));
  }
  /** Chave por data primeiro: um BETWEEN cobre o intervalo; "g" fica acima de qualquer UUID em hexadecimal minúsculo. */
  async listLogs(ownerId: string, from: string, to: string) {
    return (await this.queryAll(ownerId, "sk BETWEEN :from AND :to", { ":from": `HLOG#${from}`, ":to": `HLOG#${to}#g` })).map(toLog);
  }

  async grantXp(ownerId: string, event: XpEvent) {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...xpKey(ownerId, event.habitId, event.date, event.type), ...event }, ConditionExpression: "attribute_not_exists(pk)" }));
      return event;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: xpKey(ownerId, event.habitId, event.date, event.type), ConsistentRead: true }));
      return toEvent(result.Item ?? {});
    }
  }
  async setXpRevoked(ownerId: string, habitId: string, date: string, type: XpEvent["type"], revokedAt: string | null) {
    try {
      await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: xpKey(ownerId, habitId, date, type),
        UpdateExpression: "SET revokedAt = :at", ConditionExpression: "attribute_exists(pk)", ExpressionAttributeValues: { ":at": revokedAt } }));
    } catch (error) { if (!(error instanceof ConditionalCheckFailedException)) throw error; }
  }
  async listXpEvents(ownerId: string) { return (await this.queryAll(ownerId, "begins_with(sk, :p)", { ":p": "HXP#" })).map(toEvent); }
}

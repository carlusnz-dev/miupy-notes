import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AppError, parseInternal } from "../../../core/domain/app-error.js";
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
// Item gravado que não bate com o schema é corrupção, não erro do cliente: 500 com serviço e operação no log.
const stored = <T>(schema: z.ZodType<T>, raw: Record<string, unknown>, operation: string) => parseInternal(schema, raw, { service: "DynamoDB (hábitos)", operation });
const toHabit = (raw: Record<string, unknown>) => { const data = stored(storedHabit, raw, "ler hábito armazenado"); return new Habit(data.ownerId, data); };
const toLog = (raw: Record<string, unknown>): HabitLog => stored(storedLog, raw, "ler execução armazenada");
const toEvent = (raw: Record<string, unknown>): XpEvent => stored(storedEvent, raw, "ler evento de XP armazenado");
const busy = () => new AppError(409, "CONFLICT", "Esta ocorrência está sendo alterada por outra operação. Tente de novo.");
const cancelCodes = (error: unknown) => error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []).map(reason => reason.Code) : null;

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

  /** Chave por data primeiro: um BETWEEN cobre o intervalo; "g" fica acima de qualquer UUID em hexadecimal minúsculo. */
  async listLogs(ownerId: string, from: string, to: string) {
    return (await this.queryAll(ownerId, "sk BETWEEN :from AND :to", { ":from": `HLOG#${from}`, ":to": `HLOG#${to}#g` })).map(toLog);
  }

  /**
   * Execução e XP na mesma `TransactWriteItems`: ou os dois mudam ou nenhum. A execução é regravada igual (idempotente)
   * e o evento é um upsert que conserva `points`/`createdAt` e zera `revokedAt`; repetir ou reativar não duplica.
   */
  async completeOccurrence(log: HabitLog, event: XpEvent) {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.tableName, Item: { ...logKey(log.ownerId, log.habitId, log.date), ...log } } },
        { Update: { TableName: this.tableName, Key: xpKey(log.ownerId, event.habitId, event.date, event.type),
          UpdateExpression: "SET habitId = :habitId, #date = :date, #type = :type, points = if_not_exists(points, :points), createdAt = if_not_exists(createdAt, :createdAt), revokedAt = :none",
          ExpressionAttributeNames: { "#date": "date", "#type": "type" },
          ExpressionAttributeValues: { ":habitId": event.habitId, ":date": event.date, ":type": event.type, ":points": event.points, ":createdAt": event.createdAt, ":none": null } } },
      ] }));
    } catch (error) { throw cancelCodes(error)?.includes("TransactionConflict") ? busy() : error; }
  }
  /**
   * Apaga a execução e compensa o evento na mesma transação. O `Update` exige o evento existente (`attribute_exists`);
   * se ele não existe, a segunda transação apaga a execução sob a condição de o evento continuar ausente, e uma
   * conclusão concorrente que o criou no meio vira `409`.
   */
  async reopenOccurrence(ownerId: string, habitId: string, date: string, type: XpEvent["type"], revokedAt: string) {
    const xp = xpKey(ownerId, habitId, date, type), drop = { Delete: { TableName: this.tableName, Key: logKey(ownerId, habitId, date) } };
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [drop,
        { Update: { TableName: this.tableName, Key: xp, UpdateExpression: "SET revokedAt = :at", ConditionExpression: "attribute_exists(pk)", ExpressionAttributeValues: { ":at": revokedAt } } }] }));
      return;
    } catch (error) {
      const codes = cancelCodes(error);
      if (codes?.includes("TransactionConflict")) throw busy();
      if (codes?.[1] !== "ConditionalCheckFailed") throw error;
    }
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [drop,
        { ConditionCheck: { TableName: this.tableName, Key: xp, ConditionExpression: "attribute_not_exists(pk)" } }] }));
    } catch (error) {
      const codes = cancelCodes(error);
      if (codes?.includes("TransactionConflict") || codes?.[1] === "ConditionalCheckFailed") throw busy();
      throw error;
    }
  }
  async listXpEvents(ownerId: string) { return (await this.queryAll(ownerId, "begins_with(sk, :p)", { ":p": "HXP#" })).map(toEvent); }
}

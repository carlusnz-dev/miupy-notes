import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ServiceError } from "../../../core/domain/app-error.js";
import { Habit } from "../domain/habit.js";
import { createHabitInputSchema } from "../dto/input.js";
import { DynamoHabitsRepository } from "./dynamo-habits.repository.js";

type Command = { constructor: { name: string }; input: Record<string, unknown> };
function fake(reply: (command: Command, calls: number) => unknown) {
  const sent: Command[] = [];
  return { sent, client: { send: async (command: Command) => { sent.push(command); return reply(command, sent.length); } } as unknown as DynamoDBDocumentClient };
}
const id = "00000000-0000-4000-8000-000000000001", now = "2026-10-26T12:00:00.000Z";
const habit = new Habit("alice", { ...createHabitInputSchema.parse({ title: "Ler", recurrence: { type: "daily" }, startDate: "2026-10-01" }), id, pauses: [], deletedAt: null, purgeAfter: null, createdAt: now, updatedAt: now, version: 1 });
const failed = () => new ConditionalCheckFailedException({ message: "test", $metadata: {} });
const event = { habitId: id, date: "2026-10-26", type: "completion" as const, points: 10, createdAt: now, revokedAt: null };

test("DynamoDB: cadastro com chaves por proprietário, criação e CAS condicionais, sem Scan", async () => {
  const { client, sent } = fake(command => command.constructor.name === "GetCommand" ? { Item: { pk: "USER#alice", sk: `HABIT#${id}`, ...habit } } : {});
  const repo = new DynamoHabitsRepository(client, "t");
  await repo.create(habit); assert.match(String(sent[0].input.ConditionExpression), /attribute_not_exists/);
  assert.equal((await repo.findById("alice", id))?.title, "Ler"); assert.equal(sent[1].input.ConsistentRead, true);
  await repo.findById("bob", id); assert.deepEqual(sent[2].input.Key, { pk: "USER#bob", sk: `HABIT#${id}` });
  await repo.update(habit, 1); assert.equal(sent[3].input.ConditionExpression, "#version = :expected");
  assert.equal(sent.some(c => c.constructor.name === "ScanCommand"), false);
  assert.equal(await new DynamoHabitsRepository(fake(() => { throw failed(); }).client, "t").update(habit, 1), null);
});

test("DynamoDB: listagens paginam por prefixo e intervalo do proprietário", async () => {
  const log = { ownerId: "alice", habitId: id, date: "2026-10-26", completedAt: now, title: "Ler", kind: "other", priority: "medium" };
  const { client, sent } = fake((_c, calls) => calls === 1 ? { Items: [{ ...log, pk: "x", sk: "y" }], LastEvaluatedKey: { pk: "USER#bob", sk: "k" } } : { Items: [] });
  const repo = new DynamoHabitsRepository(client, "t");
  assert.equal((await repo.listLogs("bob", "2026-10-01", "2026-10-31")).length, 1);
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: "k" });
  assert.deepEqual(sent[0].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":from": "HLOG#2026-10-01", ":to": "HLOG#2026-10-31#g" });
  await repo.list("bob"); assert.deepEqual(sent[2].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":p": "HABIT#" });
});

type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const log = { ownerId: "alice", habitId: id, date: "2026-10-26", completedAt: now, title: "Ler", kind: "other" as const, priority: "medium" as const };
const canceled = (...codes: string[]) => new TransactionCanceledException({ message: "test", $metadata: {}, CancellationReasons: codes.map(Code => ({ Code })) });

test("DynamoDB: concluir grava execução e XP numa única transação, sem escritas soltas", async () => {
  const { client, sent } = fake(() => ({}));
  const repo = new DynamoHabitsRepository(client, "t");
  await repo.completeOccurrence(log, event);
  assert.deepEqual(sent.map(c => c.constructor.name), ["TransactWriteCommand"]);
  const [put, update] = sent[0].input.TransactItems as Item[];
  assert.equal(put.Put.Item.sk, `HLOG#2026-10-26#${id}`);
  assert.equal(update.Update.Key.sk, `HXP#${id}#2026-10-26#completion`); assert.equal(update.Update.Key.pk, "USER#alice");
  assert.match(update.Update.UpdateExpression, /points = if_not_exists\(points, :points\)/); assert.match(update.Update.UpdateExpression, /createdAt = if_not_exists\(createdAt, :createdAt\)/);
  assert.equal(update.Update.ExpressionAttributeValues[":none"], null);
});

test("DynamoDB: desmarcar apaga a execução e compensa o XP na mesma transação, condicionado ao evento existir", async () => {
  const { client, sent } = fake(() => ({}));
  await new DynamoHabitsRepository(client, "t").reopenOccurrence("alice", id, "2026-10-26", "completion", now);
  assert.equal(sent.length, 1);
  const [drop, update] = sent[0].input.TransactItems as Item[];
  assert.deepEqual(drop.Delete.Key, { pk: "USER#alice", sk: `HLOG#2026-10-26#${id}` });
  assert.equal(update.Update.ConditionExpression, "attribute_exists(pk)"); assert.equal(update.Update.ExpressionAttributeValues[":at"], now);
});

test("DynamoDB: desmarcar sem evento apaga só a execução, com o evento ainda ausente; evento surgido no meio vira 409", async () => {
  const { client, sent } = fake((_c, calls) => { if (calls === 1) throw canceled("None", "ConditionalCheckFailed"); return {}; });
  await new DynamoHabitsRepository(client, "t").reopenOccurrence("alice", id, "2026-10-26", "completion", now);
  assert.equal(sent.length, 2);
  const [drop, check] = sent[1].input.TransactItems as Item[];
  assert.ok(drop.Delete); assert.equal(check.ConditionCheck.ConditionExpression, "attribute_not_exists(pk)");
  const raced = new DynamoHabitsRepository(fake(() => { throw canceled("None", "ConditionalCheckFailed"); }).client, "t");
  await assert.rejects(raced.reopenOccurrence("alice", id, "2026-10-26", "completion", now), { status: 409, code: "CONFLICT" });
});

test("DynamoDB: transação concorrente na mesma ocorrência vira 409; outras falhas passam como estão", async () => {
  const conflicted = new DynamoHabitsRepository(fake(() => { throw canceled("None", "TransactionConflict"); }).client, "t");
  await assert.rejects(conflicted.completeOccurrence(log, event), { status: 409, code: "CONFLICT" });
  await assert.rejects(conflicted.reopenOccurrence("alice", id, "2026-10-26", "completion", now), { status: 409 });
  const outage = new Error("down");
  await assert.rejects(new DynamoHabitsRepository(fake(() => { throw outage; }).client, "t").completeOccurrence(log, event), outage);
});

test("DynamoDB: item armazenado inválido é falha interna (ServiceError), sem o conteúdo na mensagem", async () => {
  const repo = new DynamoHabitsRepository(fake(() => ({ Items: [{ ownerId: "alice", title: "segredo-123" }] })).client, "t");
  for (const read of [() => repo.list("alice"), () => repo.listLogs("alice", "2026-10-01", "2026-10-31"), () => repo.listXpEvents("alice")]) {
    await assert.rejects(read(), (error: unknown) => error instanceof ServiceError && !error.message.includes("segredo-123") && error.context.service === "DynamoDB (hábitos)");
  }
});

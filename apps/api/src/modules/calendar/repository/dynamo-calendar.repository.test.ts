import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CalendarEvent } from "../domain/calendar-event.js";
import { DynamoCalendarRepository } from "./dynamo-calendar.repository.js";

type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

function fakeClient(reply: (command: SentCommand, index: number) => unknown) {
  const sent: SentCommand[] = [];
  const client = { send: async (command: SentCommand) => { sent.push(command); return reply(command, sent.length - 1); } };
  return { sent, client: client as unknown as DynamoDBDocumentClient };
}

const now = "2026-10-21T12:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const event = (n: number, extra: Partial<{ allDay: boolean; start: string; end: string }> = {}) =>
  new CalendarEvent(id(n), "alice", "t", "", "", extra.allDay ?? false, extra.start ?? "2026-10-21T12:00:00.000Z", extra.end ?? "2026-10-21T13:00:00.000Z", extra.allDay ? null : "UTC", [], "local", null, null, now, now, 1);
const stored = (n: number) => ({ pk: "USER#alice", sk: `EVENT#${id(n)}`, ...event(n) });
const conditionFailed = () => new ConditionalCheckFailedException({ message: "condição falhou", $metadata: {} });

test("create grava com atributos derivados de período e recusa ID repetido como 409", async () => {
  const ok = fakeClient(() => ({}));
  await new DynamoCalendarRepository(ok.client, "t").create(event(1, { allDay: true, start: "2026-11-02", end: "2026-11-03" }));
  const item = ok.sent[0].input.Item as Record<string, unknown>;
  assert.equal(item.pk, "USER#alice");
  assert.equal(item.sk, `EVENT#${id(1)}`);
  assert.equal(item.startsAt, "2026-11-02T00:00:00.000Z");
  assert.equal(item.endsAt, "2026-11-04T00:00:00.000Z");
  assert.equal(ok.sent[0].input.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  const duplicate = fakeClient(() => { throw conditionFailed(); });
  await assert.rejects(new DynamoCalendarRepository(duplicate.client, "t").create(event(1)), { status: 409, code: "CONFLICT" });
});

test("list consulta só a partição do dono, mesmo com cursor de outro usuário", async () => {
  const { sent, client } = fakeClient(() => ({ Items: [stored(1)], LastEvaluatedKey: { pk: "USER#alice", sk: `EVENT#${id(1)}` } }));
  const repository = new DynamoCalendarRepository(client, "t");
  const page = await repository.list("alice", { limit: 1 });
  assert.equal(typeof page.nextCursor, "string");
  await repository.list("bob", { limit: 1, cursor: page.nextCursor! });
  assert.deepEqual(sent[1].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":prefix": "EVENT#" });
  assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: `EVENT#${id(1)}` });
  const forged = Buffer.from(JSON.stringify({ id: id(1), pk: "USER#bob" })).toString("base64url");
  await assert.rejects(repository.list("alice", { limit: 1, cursor: forged }), { status: 400 });
  await assert.rejects(repository.list("alice", { limit: 1, cursor: "nao-e-cursor" }), { status: 400 });
});

test("list com período filtra no servidor e continua lendo até juntar a página (Limit vale antes do filtro)", async () => {
  const replies = [
    { Items: [], LastEvaluatedKey: { pk: "USER#alice", sk: `EVENT#${id(2)}` } },
    { Items: [stored(3)], LastEvaluatedKey: { pk: "USER#alice", sk: `EVENT#${id(4)}` } },
    { Items: [stored(5)], LastEvaluatedKey: undefined },
  ];
  const { sent, client } = fakeClient((_c, index) => replies[index]);
  const page = await new DynamoCalendarRepository(client, "t").list("alice", { limit: 10, from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
  assert.equal(sent.length, 3);
  assert.equal(sent[0].input.FilterExpression, "startsAt < :to AND endsAt > :from");
  assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#alice", sk: `EVENT#${id(2)}` });
  assert.deepEqual(page.items.map((item) => item.id), [id(3), id(5)]);
  assert.equal(page.nextCursor, null);
});

test("list com período para no teto de leituras e devolve cursor para continuar", async () => {
  const { sent, client } = fakeClient(() => ({ Items: [], LastEvaluatedKey: { pk: "USER#alice", sk: `EVENT#${id(7)}` } }));
  const page = await new DynamoCalendarRepository(client, "t").list("alice", { limit: 10, from: "2026-10-01T00:00:00.000Z" });
  assert.equal(sent.length, 5);
  assert.deepEqual(page.items, []);
  assert.equal(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString()).id, id(7));
});

test("excedente de uma leitura volta para a próxima página: cursor é o último item devolvido", async () => {
  const { client } = fakeClient(() => ({ Items: [stored(1), stored(2), stored(3)], LastEvaluatedKey: { pk: "USER#alice", sk: `EVENT#${id(3)}` } }));
  const page = await new DynamoCalendarRepository(client, "t").list("alice", { limit: 2, to: "2027-01-01T00:00:00.000Z" });
  assert.deepEqual(page.items.map((item) => item.id), [id(1), id(2)]);
  assert.equal(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString()).id, id(2));
});

test("update grava com condição de versão; conflito devolve null", async () => {
  const ok = fakeClient(() => ({}));
  assert.ok(await new DynamoCalendarRepository(ok.client, "t").update(event(1), 1));
  assert.equal(ok.sent[0].input.ConditionExpression, "#version = :expected");
  assert.deepEqual(ok.sent[0].input.ExpressionAttributeValues, { ":expected": 1 });
  const conflict = fakeClient(() => { throw conditionFailed(); });
  assert.equal(await new DynamoCalendarRepository(conflict.client, "t").update(event(1), 1), null);
});

test("delete é condicional à versão e distingue ausente de divergente", async () => {
  const ok = fakeClient(() => ({}));
  assert.equal(await new DynamoCalendarRepository(ok.client, "t").delete("alice", id(1), 3), "deleted");
  assert.equal(ok.sent[0].input.ConditionExpression, "attribute_exists(pk) AND #version = :expected");
  const diverged = fakeClient((command) => { if (command.constructor.name === "DeleteCommand") throw conditionFailed(); return { Item: stored(1) }; });
  assert.equal(await new DynamoCalendarRepository(diverged.client, "t").delete("alice", id(1), 3), "conflict");
  const missing = fakeClient((command) => { if (command.constructor.name === "DeleteCommand") throw conditionFailed(); return {}; });
  assert.equal(await new DynamoCalendarRepository(missing.client, "t").delete("alice", id(1), 3), "missing");
});

test("upsert de espelho nunca sobrescreve evento local e remover espelho só atinge origem google", async () => {
  const guarded = fakeClient(() => { throw conditionFailed(); });
  const repository = new DynamoCalendarRepository(guarded.client, "t");
  await assert.rejects(repository.upsertMirror(event(1)), { status: 409 });
  assert.equal(guarded.sent[0].input.ConditionExpression, "attribute_not_exists(pk) OR #source = :google");
  assert.equal(await repository.deleteMirror("alice", id(1)), false);
});

test("outros erros do DynamoDB não são mascarados como conflito", async () => {
  const failing = fakeClient(() => { throw new Error("rede"); });
  const repository = new DynamoCalendarRepository(failing.client, "t");
  await assert.rejects(repository.update(event(1), 1), /rede/);
  await assert.rejects(repository.create(event(1)), /rede/);
  await assert.rejects(repository.delete("alice", id(1), 1), /rede/);
});

test("cadastro da integração fica em chave própria e sem token", async () => {
  const { sent, client } = fakeClient(() => ({}));
  const repository = new DynamoCalendarRepository(client, "t");
  await repository.saveConnection("alice", { connectionId: "c1", status: "connected", mode: "mirror", scopes: ["s"], calendarId: "primary", connectedAt: now, syncToken: null, lastSyncAt: null, lastError: null });
  const item = sent[0].input.Item as Record<string, unknown>;
  assert.deepEqual([item.pk, item.sk], ["USER#alice", "CALENDAR#GOOGLE"]);
  assert.equal(Object.keys(item).some((key) => /token$/i.test(key) && key !== "syncToken"), false);
});

test("takePending consome state atomicamente com Delete ALL_OLD na partição do proprietário", async () => {
  const pending = { state: "s", mode: "mirror", redirectUri: "http://127.0.0.1:1234/callback", expiresAt: now };
  const fake = fakeClient((_c, index) => index === 0 ? { Attributes: pending } : {});
  const repository = new DynamoCalendarRepository(fake.client, "t");
  assert.deepEqual(await repository.takePending("alice"), pending);
  assert.equal(await repository.takePending("alice"), null);
  assert.equal(fake.sent[0].constructor.name, "DeleteCommand");
  assert.deepEqual(fake.sent[0].input.Key, { pk: "USER#alice", sk: "CALENDAR#GOOGLE#PENDING" });
  assert.equal(fake.sent[0].input.ReturnValues, "ALL_OLD");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Note } from "../domain/note.js";
import { DynamoNotesRepository } from "./dynamo-notes.repository.js";

type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

// Cliente falso: registra comandos e devolve respostas fixas, sem rede nem conta AWS.
function fakeClient(reply: (command: SentCommand) => unknown) {
  const sent: SentCommand[] = [];
  const client = { send: async (command: SentCommand) => { sent.push(command); return reply(command); } };
  return { sent, client: client as unknown as DynamoDBDocumentClient };
}

const now = "2026-10-18T12:00:00.000Z";
const noteId = "0b5d6f7e-1c2a-4b3d-8e9f-a0b1c2d3e4f5";
const stored = { pk: "USER#alice", sk: `NOTE#${noteId}`, id: noteId, ownerId: "alice", title: "t", body: "", tags: [], folderId: null, createdAt: now, updatedAt: now, version: 1 };
const conditionFailed = () => new ConditionalCheckFailedException({ message: "condição falhou", $metadata: {} });

test("list consulta só a partição do proprietário, mesmo com cursor de outro usuário", async () => {
  const { sent, client } = fakeClient(() => ({ Items: [stored], LastEvaluatedKey: { pk: "USER#alice", sk: stored.sk } }));
  const repository = new DynamoNotesRepository(client, "notes");
  const page = await repository.list("alice", 1);
  assert.equal(page.items[0].id, noteId);
  assert.equal(typeof page.nextCursor, "string");

  await repository.list("bob", 1, page.nextCursor!);
  const input = sent[1].input;
  assert.deepEqual(input.ExpressionAttributeValues, { ":pk": "USER#bob", ":prefix": "NOTE#" });
  assert.deepEqual(input.ExclusiveStartKey, { pk: "USER#bob", sk: `NOTE#${noteId}` });
});

test("list sem LastEvaluatedKey devolve nextCursor nulo e cursor inválido vira 400", async () => {
  const { client } = fakeClient(() => ({ Items: [] }));
  const repository = new DynamoNotesRepository(client, "notes");
  assert.deepEqual(await repository.list("alice", 20), { items: [], nextCursor: null });
  await assert.rejects(repository.list("alice", 20, "nao-e-cursor"), { status: 400, code: "VALIDATION_ERROR" });
  const forged = Buffer.from(JSON.stringify({ id: noteId, pk: "USER#bob" })).toString("base64url");
  await assert.rejects(repository.list("alice", 20, forged), { status: 400 });
});

test("update grava com condição de versão e devolve null em conflito", async () => {
  const next = new Note(noteId, "alice", "novo", "", [], null, now, now, 2);
  const ok = fakeClient(() => ({}));
  assert.equal(await new DynamoNotesRepository(ok.client, "notes").update(next, 1), next);
  assert.equal(ok.sent[0].constructor.name, "PutCommand");
  assert.equal(ok.sent[0].input.ConditionExpression, "#version = :expected");
  assert.deepEqual(ok.sent[0].input.ExpressionAttributeValues, { ":expected": 1 });

  const conflict = fakeClient(() => { throw conditionFailed(); });
  assert.equal(await new DynamoNotesRepository(conflict.client, "notes").update(next, 1), null);
});

test("delete exige item existente e devolve false quando ausente", async () => {
  const ok = fakeClient(() => ({}));
  assert.equal(await new DynamoNotesRepository(ok.client, "notes").delete("alice", noteId), true);
  assert.deepEqual(ok.sent[0].input.Key, { pk: "USER#alice", sk: `NOTE#${noteId}` });
  assert.equal(ok.sent[0].input.ConditionExpression, "attribute_exists(pk)");

  const missing = fakeClient(() => { throw conditionFailed(); });
  assert.equal(await new DynamoNotesRepository(missing.client, "notes").delete("alice", noteId), false);
});

test("outros erros do DynamoDB não são mascarados como conflito", async () => {
  const failing = fakeClient(() => { throw new Error("rede"); });
  const repository = new DynamoNotesRepository(failing.client, "notes");
  await assert.rejects(repository.update(new Note(noteId, "alice", "t", "", [], null, now, now, 2), 1), /rede/);
  await assert.rejects(repository.delete("alice", noteId), /rede/);
});

test("API-META-01 metadata projeta sem body, mantém cursor/owner e lê legado sem folderId", async () => {
  const { body: _body, folderId: _folder, ...metadata } = stored;
  const { sent, client } = fakeClient(() => ({ Items: [metadata], LastEvaluatedKey: { pk: stored.pk, sk: stored.sk } }));
  const repository = new DynamoNotesRepository(client, "notes");
  const page = await repository.listMetadata("alice", 1);
  assert.equal("body" in page.items[0], false);
  assert.equal(page.items[0].folderId, null);
  const names = sent[0].input.ExpressionAttributeNames as Record<string, string>;
  const projected = String(sent[0].input.ProjectionExpression).split(", ").map((alias) => names[alias]);
  assert.deepEqual(projected, ["id", "ownerId", "title", "tags", "folderId", "createdAt", "updatedAt", "version"]);
  await repository.listMetadata("bob", 1, page.nextCursor!);
  assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: stored.sk });
  assert.equal(sent[1].input.Limit, 1);
  await assert.rejects(repository.listMetadata("alice", 1, "inválido"), { status: 400 });
});

test("API-DETAIL-01 detalhe usa leitura consistente para reconciliação após timeout", async () => {
  const { sent, client } = fakeClient(() => ({ Item: stored }));
  assert.equal((await new DynamoNotesRepository(client, "notes").findById("alice", noteId))?.body, stored.body);
  assert.equal(sent[0].input.ConsistentRead, true);
  assert.deepEqual(sent[0].input.Key, { pk: "USER#alice", sk: stored.sk });
});

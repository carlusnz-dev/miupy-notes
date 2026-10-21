import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "../../core/dynamo/client.js";
import { CalendarEvent } from "./domain/calendar-event.js";
import { DynamoCalendarRepository } from "./repository/dynamo-calendar.repository.js";

// Integração com DynamoDB Local: roda só com DYNAMODB_TEST_ENDPOINT e usa tabela própria, criada e removida aqui.
const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
const skip = endpoint ? false : "defina DYNAMODB_TEST_ENDPOINT (DynamoDB Local) para rodar";
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)) throw new Error("DYNAMODB_TEST_ENDPOINT deve apontar para o DynamoDB Local.");

const tableName = `miupy-calendar-test-${randomUUID()}`;
const admin = endpoint ? new DynamoDBClient({ endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } }) : null;
const repository = endpoint ? new DynamoCalendarRepository(createDynamoClient(endpoint), tableName) : null;

before(async () => {
  if (!admin) return;
  await admin.send(new CreateTableCommand({
    TableName: tableName, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
  }));
});
after(async () => { await admin?.send(new DeleteTableCommand({ TableName: tableName })); });

const now = "2026-10-21T12:00:00.000Z";
function make(owner: string, day: number, extra: { allDay?: boolean; end?: string } = {}) {
  const date = `2026-12-${String(day).padStart(2, "0")}`;
  return new CalendarEvent(randomUUID(), owner, `D${day}`, "", "", extra.allDay ?? false, extra.allDay ? date : `${date}T10:00:00.000Z`, extra.end ?? (extra.allDay ? date : `${date}T11:00:00.000Z`), extra.allDay ? null : "UTC", [], "local", null, null, now, now, 1);
}

test("persiste, lê com consistência, atualiza por versão e exclui por versão", { skip }, async () => {
  const event = await repository!.create(make("alice", 1));
  assert.equal((await repository!.findById("alice", event.id))?.title, "D1");
  assert.equal(await repository!.findById("bob", event.id), null);
  await assert.rejects(repository!.create(event), { status: 409 });
  const next = new CalendarEvent(event.id, "alice", "novo", "", "", false, event.start, event.end, "UTC", [], "local", null, null, now, now, 2);
  assert.equal(await repository!.update(next, 5), null);
  assert.equal((await repository!.update(next, 1))?.version, 2);
  assert.equal(await repository!.delete("alice", event.id, 1), "conflict");
  assert.equal(await repository!.delete("alice", event.id, 2), "deleted");
  assert.equal(await repository!.delete("alice", event.id, 2), "missing");
});

test("lista paginada com filtro de período, dia inteiro e isolamento por dono", { skip }, async () => {
  for (let day = 1; day <= 6; day++) await repository!.create(make("carol", day));
  await repository!.create(make("carol", 10, { allDay: true, end: "2026-12-12" }));
  await repository!.create(make("dave", 2));
  const all: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository!.list("carol", { limit: 3, cursor });
    all.push(...page.items.map((item) => item.title));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(new Set(all).size, 7);

  const range: string[] = [];
  cursor = undefined;
  do {
    const page = await repository!.list("carol", { limit: 2, cursor, from: "2026-12-03T00:00:00.000Z", to: "2026-12-11T00:00:00.000Z" });
    range.push(...page.items.map((item) => item.title));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(range.sort(), ["D10", "D3", "D4", "D5", "D6"]);
});

test("espelho: não sobrescreve evento local; remoção em massa só atinge origem google", { skip }, async () => {
  const local = await repository!.create(make("erin", 1));
  const mirror = new CalendarEvent(randomUUID(), "erin", "G", "", "", false, local.start, local.end, "UTC", [], "google", { provider: "google", calendarId: "primary", externalId: "x", etag: "\"1\"", syncedAt: now }, null, now, now, 1);
  await repository!.upsertMirror(mirror);
  await assert.rejects(repository!.upsertMirror(new CalendarEvent(local.id, "erin", "G", "", "", false, local.start, local.end, "UTC", [], "google", mirror.external, null, now, now, 1)), { status: 409 });
  assert.equal(await repository!.deleteAllMirrors("erin"), 1);
  assert.ok(await repository!.findById("erin", local.id));
  assert.equal(await repository!.findById("erin", mirror.id), null);
});

test("cadastro da integração e autorização pendente ficam isolados por dono", { skip }, async () => {
  await repository!.saveConnection("frank", { status: "connected", mode: "reflect", scopes: ["s"], calendarId: "primary", connectedAt: now, syncToken: "tok", lastSyncAt: now, lastError: null });
  assert.equal((await repository!.getConnection("frank"))?.syncToken, "tok");
  assert.equal(await repository!.getConnection("gina"), null);
  await repository!.savePending("frank", { state: "s", mode: "reflect", redirectUri: "http://127.0.0.1/cb", expiresAt: now });
  assert.equal((await repository!.getPending("frank"))?.state, "s");
  await repository!.clearPending("frank");
  assert.equal(await repository!.getPending("frank"), null);
  await repository!.deleteConnection("frank");
  assert.equal(await repository!.getConnection("frank"), null);
});

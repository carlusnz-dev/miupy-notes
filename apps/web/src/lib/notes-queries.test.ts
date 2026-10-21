import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryObserver, type InfiniteData } from "@tanstack/react-query";
import { cacheSavedNote, cacheCreatedNote, cacheDeletedNote, noteKeys } from "./notes-queries-cache";
import type { NoteOutput, NoteMetadataListOutput } from "./notes-api";

const base: NoteOutput = { id: "00000000-0000-4000-8000-000000000001", title: "Base", body: "texto", tags: [], folderId: null, createdAt: "2026-10-20T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z", version: 1 };
const metadata = ({ body: _body, ...note }: NoteOutput) => note;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const pages: InfiniteData<NoteMetadataListOutput> = { pages: [{ items: [metadata(base)], nextCursor: "opaque-cursor" }, { items: [], nextCursor: null }], pageParams: [undefined, "opaque-cursor"] };
  client.setQueryData(noteKeys.list(), pages);
  client.setQueryData(noteKeys.everything(), { items: [metadata(base)], truncated: true });
  client.setQueryData(noteKeys.detail(base.id), base);
  return { client, pages };
}

test("CACHE-01 PATCH atualiza metadados, preserva páginas/cursor e não refaz coleção ativa", async () => {
  const { client, pages } = setup();
  let collectionReads = 0;
  let summaryReads = 0;
  client.setQueryData(noteKeys.summary(30, 0), { total: 1 });
  const list = new QueryObserver(client, { queryKey: noteKeys.list(), queryFn: async () => { collectionReads++; return pages; } });
  const summary = new QueryObserver(client, { queryKey: noteKeys.summary(30, 0), queryFn: async () => { summaryReads++; return { total: 1 }; } });
  const unsubList = list.subscribe(() => {});
  const unsubSummary = summary.subscribe(() => {});
  const saved = { ...base, title: "Novo", body: "texto mais recente", tags: ["tag"], version: 2 };
  cacheSavedNote(client, saved);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const current = client.getQueryData<InfiniteData<NoteMetadataListOutput>>(noteKeys.list())!;
  assert.deepEqual(current.pageParams, pages.pageParams);
  assert.equal(current.pages[0].nextCursor, "opaque-cursor");
  assert.equal(current.pages[1].items.length, 0);
  assert.deepEqual(current.pages[0].items[0], metadata(saved));
  assert.equal("body" in current.pages[0].items[0], false);
  assert.deepEqual(client.getQueryData(noteKeys.everything()), { items: [metadata(saved)], truncated: true });
  assert.deepEqual(client.getQueryData(noteKeys.detail(base.id)), saved);
  assert.equal(collectionReads, 0);
  assert.equal(summaryReads, 1);
  unsubList(); unsubSummary(); client.clear();
});

test("CACHE-02 mover mantém métricas e só altera registro conhecido, sem inserir página", () => {
  const { client } = setup();
  client.setQueryData(noteKeys.summary(7, -180), { total: 1 });
  const moved = { ...base, folderId: "00000000-0000-4000-8000-000000000002", version: 2 };
  cacheSavedNote(client, moved);
  assert.equal(client.getQueryState(noteKeys.summary(7, -180))?.isInvalidated, false);
  cacheSavedNote(client, { ...base, id: "00000000-0000-4000-8000-000000000003" });
  assert.equal(client.getQueryData<InfiniteData<NoteMetadataListOutput>>(noteKeys.list())?.pages[0].items.length, 1);
  client.clear();
});

test("CACHE-03 create/delete invalidam coleção; resposta antiga/excluída não ressuscita nota", () => {
  const { client } = setup();
  cacheCreatedNote(client, { ...base, version: 2 });
  assert.equal(client.getQueryState(noteKeys.list())?.isInvalidated, true);
  cacheSavedNote(client, base);
  assert.equal(client.getQueryData<NoteOutput>(noteKeys.detail(base.id))?.version, 2);
  cacheDeletedNote(client, base.id);
  cacheSavedNote(client, { ...base, version: 3 });
  assert.equal(client.getQueryData(noteKeys.detail(base.id)), undefined);
  client.clear();
});

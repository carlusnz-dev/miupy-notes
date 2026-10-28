import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryCalendarStore } from "./store";

Object.assign(globalThis, {
  isTauri: true,
  window: { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string) => command === "auth_status" ? { signedIn: true } : null } },
});

test("401 atrasado da outbox de uma sessão encerrada não expira o novo login", async () => {
  const auth = await import("../lib/auth");
  const { useCalendar } = await import("./use-calendar");
  await auth.initAuth();
  let current = true;
  let rejectRequest!: (error: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const store = createMemoryCalendarStore();
  let calendar!: ReturnType<typeof useCalendar>;
  function Capture() {
    calendar = useCalendar({ ownerId: "alice", store, isCurrent: () => current, remote: {
      create: () => new Promise((_resolve, reject) => { rejectRequest = reject; started(); }),
      update: async () => { throw new Error("Não esperado"); },
      remove: async () => {},
      get: async () => { throw new Error("Não esperado"); },
      listRange: async () => [],
    } });
    return null;
  }
  // Captura os comandos do hook sem iniciar efeitos de rede ou timers de interface.
  renderToString(createElement(Capture));
  await calendar.submit({ kind: "create", eventId: "old-session-event", draft: {
    title: "Sintético", description: "", location: "", allDay: true,
    start: "2026-10-28", end: "2026-10-29", timeZone: null, links: [],
  } });
  await ready;
  current = false;
  auth.expireSession();
  await auth.signIn();
  const newSession = auth.getAuthSessionVersion();
  assert.equal(auth.isCurrentAuthSession(newSession), true);
  rejectRequest(Object.assign(new Error("Sessão antiga"), { code: "UNAUTHORIZED", status: 401 }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(auth.isCurrentAuthSession(newSession), true);
  assert.equal((await store.listOps("alice")).length, 1, "envio pendente continua preservado");
});

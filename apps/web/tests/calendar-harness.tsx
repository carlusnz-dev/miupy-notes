// Página só para validação visual via MCP (vite dev em /tests/calendar-harness.html); não entra no build.
// Servidor e Google são falsos e vivem na página; todos os dados são sintéticos. Controle: window.__fake.
import ReactDOM from "react-dom/client";
import tokens from "../../../styles/tokens.json";
import type { CSSProperties } from "react";
import CalendarWorkspace, { type GoogleApi } from "../src/calendar/CalendarWorkspace";
import { createIndexedDbCalendarStore } from "../src/calendar/store";
import type { RangeRemote } from "../src/calendar/use-calendar";
import type { CalendarEventOutput, TaskOutput } from "../src/lib/calendar-api";
import type { TasksApi } from "../src/calendar/tasks";
import "../src/fonts.css";
import "../src/typography.css";
import "../src/App.css";

const theme = {
  "--color-background": tokens.colors.background, "--color-surface": tokens.colors.surface, "--color-surface-raised": tokens.colors.surfaceRaised,
  "--color-text": tokens.colors.text, "--color-muted": tokens.colors.textMuted, "--color-border": tokens.colors.border,
  "--color-border-strong": tokens.colors.borderStrong, "--color-accent": tokens.colors.accent, "--color-accent-text": tokens.colors.accentText, "--color-focus": tokens.colors.focus,
  "--radius-small": `${tokens.radiusPx.small}px`, "--radius-medium": `${tokens.radiusPx.medium}px`, "--duration": `${tokens.motion.defaultDurationMs}ms`,
} as CSSProperties;

const stamp = new Date().toISOString();
const at = (dayOffset: number, hour: number, minute = 0) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + dayOffset, hour, minute).toISOString();
const dateOf = (dayOffset: number) => { const d = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + dayOffset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let n = 0;
const make = (extra: Partial<CalendarEventOutput>): CalendarEventOutput => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, title: "Evento", description: "", location: "", allDay: false, start: at(0, 9), end: at(0, 10), timeZone: "America/Sao_Paulo", links: [], source: "local", readOnly: false, external: null, reflection: null, createdAt: stamp, updatedAt: stamp, version: 1, ...extra });

const events = new Map<string, CalendarEventOutput>();
for (const event of [
  make({ title: "Planejamento semanal", start: at(0, 9), end: at(0, 10, 30), location: "Sala 2" }),
  make({ title: "Revisão de notas", start: at(0, 10), end: at(0, 11), description: "Sintético" }),
  make({ title: "Almoço", start: at(0, 12, 30), end: at(0, 13, 30) }),
  make({ title: "Call com fuso de Lisboa", start: at(0, 16), end: at(0, 17), timeZone: "Europe/Lisbon" }),
  make({ title: "Reunião do Google", start: at(1, 14), end: at(1, 15), source: "google", readOnly: true, timeZone: "America/Sao_Paulo", external: { provider: "google", calendarId: "primary", syncedAt: stamp } }),
  make({ title: "Viagem (dia inteiro)", allDay: true, start: dateOf(2), end: dateOf(4), timeZone: null }),
  make({ title: "Dentista", start: at(3, 8), end: at(3, 9) }),
  make({ title: "Planejar o mês", start: at(7, 9), end: at(7, 10) }),
  // Série sintética: mesmo título, horário e local em dias diferentes (um bloco só nos próximos eventos).
  ...[0, 3, 4, 5, 6].map((offset) => make({ title: "Trabalho", start: at(offset, 13), end: at(offset, 19), location: "Escritório fictício", source: "google", readOnly: true, external: { provider: "google", calendarId: "primary", syncedAt: stamp } })),
  ...[1, 2].map((offset) => make({ title: "Academia", start: at(offset, 7), end: at(offset, 8) })),
]) events.set(event.id, event);

let t = 0;
const task = (extra: Partial<TaskOutput>): TaskOutput => ({ id: `00000000-0000-4000-9000-${String(++t).padStart(12, "0")}`, title: "Tarefa", description: "", dueDate: null, dueTime: null, status: "pending", completedAt: null, inGoogle: false, createdAt: stamp, updatedAt: stamp, version: 1, ...extra });
const tasks = new Map<string, TaskOutput>();
for (const item of [
  task({ title: "Enviar relatório (atrasada)", dueDate: dateOf(-1), dueTime: "18:00" }),
  task({ title: "Pagar boleto (atrasada)", dueDate: dateOf(-3) }),
  task({ title: "Ligar para o dentista", dueDate: dateOf(0), dueTime: "16:30" }),
  task({ title: "Comprar presente", dueDate: dateOf(1) }),
  task({ title: "Revisar contrato", dueDate: dateOf(0), status: "completed", completedAt: stamp }),
  task({ title: "Algum dia" }),
]) tasks.set(item.id, item);

const fake = { failTasks: false, failUpdates: false, tasks, online: !new URLSearchParams(location.search).has("offline"), latencyMs: 30, events, calls: [] as string[], conflictOn: new Set<string>() };
(window as unknown as { __fake: typeof fake }).__fake = fake;
const offlineError = () => Object.assign(new Error("sem rede"), { code: "NETWORK_ERROR" });
const http = (status: number, code: string) => Object.assign(new Error(code), { code, status });
const wait = () => new Promise((resolve) => setTimeout(resolve, fake.latencyMs));
async function gate(label: string) { fake.calls.push(label); await wait(); if (!fake.online) throw offlineError(); }

const remote: RangeRemote = {
  async listRange(range) { await gate("list"); return [...events.values()].filter((e) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start) < range.to && (e.allDay ? `${e.end}T23:59:59.999Z` : e.end) > range.from); },
  async get(id) { await gate(`get:${id}`); const found = events.get(id); if (!found) throw http(404, "NOT_FOUND"); return found; },
  async create(id, draft) { await gate(`create:${id}`); const existing = events.get(id); if (existing) return existing; const event = make({ id, ...draft }); events.set(id, event); return event; },
  async update(id, version, draft) {
    await gate(`update:${id}@${version}`);
    if (fake.failUpdates) throw http(400, "VALIDATION_ERROR");
    const current = events.get(id);
    if (!current) throw http(404, "NOT_FOUND");
    if (current.version !== version || fake.conflictOn.has(id)) throw http(409, "CONFLICT");
    const next = { ...current, ...draft, version: version + 1 }; events.set(id, next); return next;
  },
  async remove(id, version) { await gate(`remove:${id}@${version}`); const current = events.get(id); if (!current) throw http(404, "NOT_FOUND"); if (current.version !== version) throw http(409, "CONFLICT"); events.delete(id); },
};
const tasksApi: TasksApi = {
  async list() { await gate("tasks:list"); return [...tasks.values()]; },
  async create(id, draft) { await gate(`tasks:create:${id}`); if (fake.failTasks) throw http(503, "UNAVAILABLE"); const created = task({ id, ...draft, completedAt: draft.status === "completed" ? new Date().toISOString() : null }); tasks.set(id, created); return created; },
  async update(id, version, changes) {
    await gate(`tasks:update:${id}@${version}`);
    const current = tasks.get(id);
    if (!current) throw http(404, "NOT_FOUND");
    if (fake.failTasks || current.version !== version) throw http(409, "CONFLICT");
    const next = { ...current, ...changes, completedAt: (changes.status ?? current.status) === "completed" ? (current.completedAt ?? new Date().toISOString()) : null, version: version + 1 };
    tasks.set(id, next); return next;
  },
  async remove(id, version) { await gate(`tasks:remove:${id}@${version}`); const current = tasks.get(id); if (!current) throw http(404, "NOT_FOUND"); if (current.version !== version) throw http(409, "CONFLICT"); tasks.delete(id); },
};
const google: GoogleApi = {
  async getStatus() { return { state: "not_configured", mode: null, scopes: [], calendarId: null, connectedAt: null, lastSyncAt: null, lastError: null, hasSyncCursor: false }; },
  async sync() { throw http(409, "INTEGRATION_NOT_CONFIGURED"); },
  async reflect() { throw http(409, "INTEGRATION_NOT_CONFIGURED"); },
  async unreflect() { throw http(409, "INTEGRATION_NOT_CONFIGURED"); },
};
const notes = [{ id: "11111111-1111-4111-8111-111111111111", title: "Ideias de projeto" }, { id: "22222222-2222-4222-8222-222222222222", title: "Lista de leitura" }];
const store = createIndexedDbCalendarStore();
const owner = new URLSearchParams(location.search).get("owner") ?? "harness-owner";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <div className="app-shell" style={{ ...theme, gridTemplateColumns: "minmax(0, 1fr)" }}>
    <main className="main-content"><div className="page-scroll"><div className="page-content">
      <CalendarWorkspace ownerId={owner} store={store} remote={remote} loadNotes={async () => notes} google={google} tasksApi={tasksApi} />
    </div></div></main>
  </div>,
);

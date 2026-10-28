// Demonstração só de desenvolvimento (vite dev em /tests/demo-harness.html); não entra no build.
// Renderiza o App real com login simulado (mockIPC) e uma API em memória no adapter do Axios:
// nenhuma requisição sai do navegador e todos os dados abaixo são fictícios.
import { mockIPC } from "@tauri-apps/api/mocks";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CalendarEventOutput } from "../src/lib/calendar-api";
import type { Account, Bank, Transaction } from "../src/lib/finance-api";
import type { FolderOutput } from "../src/lib/notes-folders-api";
import type { NoteOutput } from "../src/lib/notes-api";
import { computeNoteDetails, computeNoteStats } from "../src/lib/note-stats";

const params = new URLSearchParams(location.search);
const owner = params.get("owner") ?? "demo-owner";
const googleState = params.get("google") ?? "connected";

Object.assign(globalThis, { isTauri: true });
mockIPC((command) => {
  if (command === "auth_status") return { signedIn: true };
  if (command === "auth_id_token") return `synthetic.${btoa(JSON.stringify({ sub: owner, name: "Pessoa Fictícia" }))}.synthetic`;
  if (command === "calendar_google_cancel") return null;
  throw new Error("DEMO_ONLY");
});

// ---- Dados fictícios -------------------------------------------------------------------
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const now = new Date();
const stamp = now.toISOString();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const at = (day: number, hour: number, minute = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hour, minute).toISOString();
const dateOf = (day: number) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const meta = (created = stamp) => ({ id: uuid(), createdAt: created, updatedAt: created, version: 1 });

const folder = (name: string, parentId: string | null = null): FolderOutput => ({ ...meta(daysAgo(40)), name, parentId });
const projects = folder("Projetos");
const app = folder("Aplicativo pessoal", projects.id);
const reading = folder("Leituras");
const journal = folder("Diário");
const folders = [projects, app, reading, journal];

const note = (title: string, body: string, tags: string[], folderId: string | null, age: number): NoteOutput => ({ ...meta(daysAgo(age)), updatedAt: daysAgo(Math.max(0, age - 1)), title, body, tags, folderId });
const notes = [
  note("Roteiro do trimestre", "# Roteiro do trimestre\n\nTrês frentes, nesta ordem:\n\n1. **Agenda** com contexto de notas\n2. Finanças por conta\n3. Biblioteca cultural\n\n> Primeiro o que uso todo dia.\n\n- [x] Esboçar telas\n- [ ] Validar com dados fictícios", ["planejamento", "trimestre"], projects.id, 2),
  note("Decisões de interface", "## Tipografia\n\nTítulos em serifa editorial; corpo em sans. Evitar mais de duas famílias por tela.\n\n## Movimento\n\nTransições curtas (180–280 ms) e sempre com `prefers-reduced-motion`.", ["design", "decisão"], app.id, 5),
  note("Ideias soltas para a agenda", "- Visão de semana com densidade compacta\n- Arrastar para reagendar\n- Ligar evento a nota de reunião", ["ideias", "agenda"], app.id, 1),
  note("Ensaios sobre o tempo", "Leitura em andamento. Capítulo 3 fala sobre *ritmo* e atenção.\n\n| Capítulo | Status |\n|---|---|\n| 1 | lido |\n| 2 | lido |\n| 3 | lendo |", ["leitura"], reading.id, 9),
  note("Lista de leitura 2026", "1. Um romance longo\n2. Um livro de ensaios\n3. Poesia brasileira contemporânea", ["leitura", "lista"], reading.id, 21),
  note("Segunda-feira", "Dia produtivo. Revisei o orçamento do mês e fechei a pauta da reunião de quarta.", ["pessoal"], journal.id, 3),
  note("Domingo", "Caminhada longa no parque. Pensar menos em telas.", ["pessoal"], journal.id, 4),
  note("Rascunho sem pasta", "Texto curto para testar notas na raiz.", [], null, 0),
];

const event = (extra: Partial<CalendarEventOutput>): CalendarEventOutput => ({ ...meta(), title: "Evento", description: "", location: "", allDay: false, start: at(0, 9), end: at(0, 10), timeZone: "America/Sao_Paulo", links: [], source: "local", readOnly: false, external: null, reflection: null, ...extra });
const google = (extra: Partial<CalendarEventOutput>) => event({ source: "google", readOnly: true, external: { provider: "google", calendarId: "primary", syncedAt: stamp }, ...extra });
const taskItem = (title: string, dueDay: number | null, dueTime: string | null = null, status: "pending" | "completed" = "pending") => ({ ...meta(), title, description: "", dueDate: dueDay === null ? null : dateOf(dueDay), dueTime, status, completedAt: null, inGoogle: false });
// `?tarefas=vazio` esvazia a lista (estado "Nada para hoje" do Início).
const tasks = params.get("tarefas") === "vazio" ? [] : [taskItem("Pagar a fatura do cartão", -2, "09:00"), taskItem("Enviar o relatório", -1), taskItem("Renovar o passaporte", -9), taskItem("Ligar para o dentista", -3), taskItem("Comprar presente", 2), taskItem("Arquivar notas antigas", -5, null, "completed")];
const events = new Map<string, CalendarEventOutput>();
for (const item of [
  event({ title: "Planejamento semanal", start: at(0, 9), end: at(0, 10, 30), location: "Sala 2", links: [{ kind: "note", id: notes[0].id }] }),
  event({ title: "Revisão de notas", start: at(0, 10), end: at(0, 11), description: "Revisar decisões de interface." }),
  google({ title: "Daily do time", start: at(0, 10, 15), end: at(0, 10, 45), location: "Videochamada" }),
  event({ title: "Almoço com Ana", start: at(0, 12, 30), end: at(0, 13, 30), location: "Restaurante fictício" }),
  event({ title: "Leitura antes de dormir", start: at(0, 22), end: at(0, 23), links: [{ kind: "note", id: notes[3].id }] }),
  event({ title: "Call com fuso de Lisboa", start: at(0, 16), end: at(0, 17), timeZone: "Europe/Lisbon" }),
  google({ title: "Reunião de produto", start: at(1, 14), end: at(1, 15) }),
  event({ title: "Academia", start: at(1, 7), end: at(1, 8) }),
  event({ title: "Viagem a Curitiba", allDay: true, start: dateOf(2), end: dateOf(4), timeZone: null }),
  google({ title: "Feriado municipal", allDay: true, start: dateOf(5), end: dateOf(5), timeZone: null }),
  event({ title: "Dentista", start: at(3, 8), end: at(3, 9), location: "Clínica fictícia" }),
  event({ title: "Escrever relatório", start: at(3, 14), end: at(3, 17) }),
  google({ title: "1:1 com liderança", start: at(3, 15), end: at(3, 15, 30) }),
  event({ title: "Pagar fatura do cartão", start: at(4, 9), end: at(4, 9, 15) }),
  event({ title: "Planejar o mês", start: at(7, 9), end: at(7, 10) }),
  event({ title: "Aniversário da Bia", allDay: true, start: dateOf(10), end: dateOf(10), timeZone: null }),
  event({ title: "Retrospectiva", start: at(-2, 15), end: at(-2, 16) }),
  google({ title: "Workshop de escrita", start: at(-5, 19), end: at(-5, 21) }),
  event({ title: "Consulta médica", start: at(18, 11), end: at(18, 12) }),
]) events.set(item.id, item);

const bank = (title: string): Bank => ({ ...meta(daysAgo(60)), title, logo: null });
const banks = [bank("Banco Aurora"), bank("Cooperativa Horizonte")];
const account = (title: string, bankId: string, openingBalanceCents: number): Account => ({ ...meta(daysAgo(60)), title, bankId, currency: "BRL", source: "manual", openingBalanceCents, openingDate: dateOf(-60) });
const accounts = [account("Conta corrente", banks[0].id, 420_000), account("Reserva", banks[1].id, 1_250_000)];
const tx = (title: string, amountCents: number, direction: "income" | "expense", day: number, category: string, accountIndex: number | null, extra: Partial<Transaction> = {}): Transaction => {
  const acc = accountIndex === null ? null : accounts[accountIndex];
  return { ...meta(daysAgo(-day)), title, amountCents, currency: "BRL", direction, date: dateOf(day), category, tags: [], bankId: acc?.bankId ?? null, bankTitle: acc ? banks.find((b) => b.id === acc.bankId)!.title : null, accountId: acc?.id ?? null, source: "Manual", link: "none", linkedMonth: null, installmentCount: null, paymentMethod: direction === "expense" ? "pix" : null, ...extra };
};
const transactions = [
  tx("Salário", 820_000, "income", -20, "Trabalho", 0, { link: "salary", linkedMonth: dateOf(-20).slice(0, 7), tags: ["fixo"] }),
  tx("Aluguel", 260_000, "expense", -18, "Moradia", 0, { link: "monthlyBills", linkedMonth: dateOf(-18).slice(0, 7), tags: ["fixo"], paymentMethod: "transfer" }),
  tx("Mercado da semana", 38_790, "expense", -6, "Alimentação", 0, { tags: ["casa"], paymentMethod: "card", installmentCount: 1 }),
  tx("Notebook", 640_000, "expense", -12, "Equipamento", 0, { paymentMethod: "card", installmentCount: 10, tags: ["trabalho"] }),
  tx("Freela de design", 180_000, "income", -9, "Trabalho", 1),
  tx("Farmácia", 7_450, "expense", -3, "Saúde", 0, { paymentMethod: "cash" }),
  tx("Livros", 15_990, "expense", -2, "Cultura", null, { tags: ["leitura"] }),
  tx("Rendimento", 9_870, "income", -1, "Investimentos", 1),
];

// ---- API em memória ---------------------------------------------------------------------
const httpError = (config: InternalAxiosRequestConfig, status: number, code: string) =>
  new AxiosError(code, String(status), config, null, { status, statusText: code, headers: {}, config, data: { error: { code, message: code === "NOT_FOUND" ? "Não encontrado (demonstração)." : "Indisponível na demonstração." } } });
const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const withoutBody = ({ body: _body, ...rest }: NoteOutput) => rest;
function totals() {
  const sum = (direction: "income" | "expense") => transactions.filter((t) => t.direction === direction).reduce((total, t) => total + t.amountCents, 0);
  return { currencies: [{ currency: "BRL" as const, incomeCents: sum("income"), expenseCents: sum("expense"), balanceCents: sum("income") - sum("expense"), count: transactions.length }] };
}
function balances() {
  const movement = (accountId: string | null) => transactions.filter((t) => t.accountId === accountId).reduce((total, t) => total + (t.direction === "income" ? t.amountCents : -t.amountCents), 0);
  const rows = accounts.map((a) => ({ ...a, source: "manual" as const, movementCents: movement(a.id), balanceCents: a.openingBalanceCents + movement(a.id) }));
  const unallocated = movement(null);
  return {
    calculatedAt: stamp, accounts: rows,
    banks: banks.map((b) => ({ bankId: b.id, title: b.title, currencies: [{ currency: "BRL" as const, balanceCents: rows.filter((r) => r.bankId === b.id).reduce((t, r) => t + r.balanceCents, 0) }] })),
    currencies: [{ currency: "BRL" as const, balanceCents: rows.reduce((t, r) => t + r.balanceCents, 0) + unallocated, unallocatedCents: unallocated }],
  };
}
const googleStatus = () => ({ state: googleState as "connected", mode: googleState === "connected" ? "mirror" as const : null, scopes: [], calendarId: googleState === "connected" ? "primary" : null, connectedAt: googleState === "connected" ? daysAgo(10) : null, lastSyncAt: googleState === "connected" ? daysAgo(0.02) : null, lastError: null, hasSyncCursor: googleState === "connected" });

function route(config: InternalAxiosRequestConfig): unknown {
  const method = (config.method ?? "get").toLowerCase();
  const path = (config.url ?? "").replace(/\?.*$/, "");
  const body = typeof config.data === "string" && config.data ? JSON.parse(config.data) : {};
  const query = config.params ?? {};
  const id = decodeURIComponent(path.split("/").pop() ?? "");
  if (path === "/v1/notes/metadata") return page(notes.map(withoutBody));
  if (path === "/v1/notes/summary") return { ...computeNoteStats(notes, Number(query.days) || 30), ...computeNoteDetails(notes) };
  if (path === "/v1/notes" && method === "get") return page(notes);
  if (path === "/v1/notes" && method === "post") { const created = note(body.title ?? "", body.body ?? "", body.tags ?? [], body.folderId ?? null, 0); notes.unshift(created); return created; }
  if (path.startsWith("/v1/notes/")) {
    const index = notes.findIndex((item) => item.id === id);
    if (index < 0) throw httpError(config, 404, "NOT_FOUND");
    if (method === "patch") notes[index] = { ...notes[index], ...body, version: notes[index].version + 1, updatedAt: new Date().toISOString() };
    if (method === "delete") { notes.splice(index, 1); return null; }
    return notes[index];
  }
  if (path === "/v1/folders" && method === "get") return { items: folders };
  if (path === "/v1/folders" && method === "post") { const created = folder(body.name, body.parentId ?? null); folders.push(created); return created; }
  if (path === "/v1/calendar/tasks" && method === "get") return page(tasks);
  if (path === "/v1/calendar/events" && method === "get") {
    const inRange = [...events.values()].filter((e) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start) < query.to && (e.allDay ? `${e.end}T23:59:59.999Z` : e.end) > query.from);
    return page(inRange);
  }
  if (path === "/v1/calendar/events" && method === "post") { const created = event({ ...body, id: body.id }); events.set(created.id, created); return created; }
  if (path === "/v1/calendar/google") return googleStatus();
  if (path === "/v1/calendar/google/sync") return { kind: "incremental", pages: 1, upserted: 0, deleted: 0, resynced: false, lastSyncAt: new Date().toISOString() };
  if (path.startsWith("/v1/calendar/events/")) {
    const current = events.get(id);
    if (!current) throw httpError(config, 404, "NOT_FOUND");
    if (method === "patch") { const { version: _version, ...draft } = body; const next = { ...current, ...draft, version: current.version + 1 }; events.set(id, next); return next; }
    if (method === "delete") { events.delete(id); return null; }
    return current;
  }
  if (path === "/v1/finance/transactions") return page(transactions);
  if (path.startsWith("/v1/finance/transactions/")) { const found = transactions.find((t) => t.id === id); if (!found) throw httpError(config, 404, "NOT_FOUND"); return found; }
  if (path === "/v1/finance/summary") return totals();
  if (path === "/v1/finance/banks") return page(banks);
  if (path === "/v1/finance/accounts") return page(accounts);
  if (path === "/v1/finance/balances") return balances();
  throw httpError(config, 409, "DEMO_UNSUPPORTED");
}

const { apiClient } = await import("../src/lib/api-client");
apiClient.defaults.adapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  const data = route(config);
  return { data, status: data === null ? 204 : 200, statusText: "OK", headers: new AxiosHeaders(), config };
};

await import("../src/lib/local-fonts");
const { initAuth } = await import("../src/lib/auth");
await initAuth();
const { default: App } = await import("../src/App");
const { queryClient } = await import("../src/lib/query-client");
// Medição de renderização (só na demonstração): window.__profile soma commits e tempo de render do React.
const profile = { commits: 0, ms: 0, reset() { this.commits = 0; this.ms = 0; } };
Object.assign(window, { __profile: profile });
createRoot(document.getElementById("root") as HTMLElement).render(
  <Profiler id="app" onRender={(_id, _phase, actual) => { profile.commits++; profile.ms += actual; }}>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </Profiler>,
);

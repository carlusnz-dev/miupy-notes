import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, isAuthConfigured } from "./lib/api-client";
import { listNotes, type NoteOutput } from "./lib/notes-api";
import { usePageTitle } from "./lib/use-page-title";

type State =
  | { status: "loading" }
  | { status: "ready"; items: NoteOutput[]; nextCursor: string | null; loadingMore?: boolean }
  | { status: "error"; error: ApiError };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });

// Só em desenvolvimento: `#/notes?estado=carregando|vazio|erro|lista` força um estado para validar a tela.
function previewState(name: string | null): State | null {
  if (!import.meta.env.DEV || !name) return null;
  const now = new Date().toISOString();
  const sample = (id: string, title: string, tags: string[]): NoteOutput => ({ id, title, body: "", tags, createdAt: now, updatedAt: now, version: 1 });
  const states: Record<string, State> = {
    carregando: { status: "loading" },
    vazio: { status: "ready", items: [], nextCursor: null },
    erro: { status: "error", error: new ApiError("INTERNAL_ERROR", "Erro interno.", 500, "00000000-0000-4000-8000-000000000000") },
    lista: {
      status: "ready",
      nextCursor: "exemplo",
      items: [
        sample("00000000-0000-4000-8000-000000000001", "Nota de exemplo", ["exemplo"]),
        sample("00000000-0000-4000-8000-000000000002", "Outra nota de exemplo com um título mais longo para testar a quebra de linha", []),
      ],
    },
  };
  return states[name] ?? null;
}

function StatePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="state-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export default function NotesPage() {
  usePageTitle("Notas");
  const [searchParams] = useSearchParams();
  const preview = previewState(searchParams.get("estado"));
  const isPreview = preview !== null;
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const authConfigured = isAuthConfigured();

  useEffect(() => {
    if (isPreview) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    listNotes({ signal: controller.signal })
      .then((page) => setState({ status: "ready", items: page.items, nextCursor: page.nextCursor }))
      .catch((error: ApiError) => { if (!controller.signal.aborted) setState({ status: "error", error }); });
    return () => controller.abort();
  }, [attempt, isPreview]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await listNotes({ cursor: state.nextCursor });
      setState({ status: "ready", items: [...state.items, ...page.items], nextCursor: page.nextCursor });
    } catch (error) {
      setState({ status: "error", error: error as ApiError });
    }
  }, [state]);

  const view = preview ?? state;

  return (
    <div className="feature-page notes-page">
      <div className="eyebrow">NOTAS</div>
      <h1>Notas<em>.</em></h1>
      <p className="lead">Ideias, páginas e conexões em um lugar.</p>

      {!authConfigured && (
        <p className="local-notice" id="notes-auth-notice">
          <span className="notice-dot" aria-hidden="true" />
          Sem conta conectada: este app ainda não envia nenhuma requisição à API. O login com Google será o próximo passo.
        </p>
      )}

      <div className="notes-toolbar">
        <span>{view.status === "ready" ? `${view.items.length} ${view.items.length === 1 ? "nota" : "notas"}` : "Suas notas"}</span>
        <button type="button" className="button" disabled={!authConfigured} aria-describedby={authConfigured ? undefined : "notes-auth-notice"}>
          Nova nota
        </button>
      </div>

      <section aria-live="polite" aria-busy={view.status === "loading"}>
        {view.status === "loading" && (
          <div className="note-skeletons" role="status">
            <span className="visually-hidden">Carregando notas…</span>
            {[0, 1, 2].map((index) => <div className="note-skeleton" key={index} aria-hidden="true" />)}
          </div>
        )}

        {view.status === "error" && view.error.code === "AUTH_NOT_CONFIGURED" && (
          <StatePanel title="Conta não conectada">
            <p>Suas notas aparecerão aqui depois do login.</p>
          </StatePanel>
        )}

        {view.status === "error" && view.error.code !== "AUTH_NOT_CONFIGURED" && (
          <StatePanel title="Não foi possível carregar as notas">
            <p>{view.error.message}</p>
            {view.error.requestId && <p className="muted-small">Código do pedido: <code>{view.error.requestId}</code></p>}
            <button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Tentar de novo</button>
          </StatePanel>
        )}

        {view.status === "ready" && view.items.length === 0 && (
          <StatePanel title="Nenhuma nota ainda">
            <p>Quando você criar uma nota, ela aparece aqui com título, tags e data de edição.</p>
          </StatePanel>
        )}

        {view.status === "ready" && view.items.length > 0 && (
          <>
            <ul className="note-list">
              {view.items.map((note) => (
                <li key={note.id} className="note-row">
                  <strong>{note.title}</strong>
                  <span className="note-meta">
                    {note.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                    <time dateTime={note.updatedAt}>{dateFormat.format(new Date(note.updatedAt))}</time>
                  </span>
                </li>
              ))}
            </ul>
            {view.nextCursor && (
              <button type="button" className="button button-secondary load-more" onClick={loadMore} disabled={view.loadingMore || isPreview}>
                {view.loadingMore ? "Carregando…" : "Carregar mais"}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "./lib/api-client";
import { expireSession, signIn, signOut, useAuth, type AuthStatus } from "./lib/auth";
import { createNote, listNotes, type NoteOutput } from "./lib/notes-api";
import { usePageTitle } from "./lib/use-page-title";

type State =
  | { status: "loading" }
  | { status: "ready"; items: NoteOutput[]; nextCursor: string | null; loadingMore?: boolean }
  | { status: "error"; error: ApiError };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });

type Preview = { auth: AuthStatus; notes: State };

// Só em desenvolvimento: `#/notes?estado=carregando|vazio|erro|lista|deslogado` força um estado para validar a tela.
function previewState(name: string | null): Preview | null {
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
  if (name === "deslogado") return { auth: "signed-out", notes: { status: "loading" } };
  return states[name] ? { auth: "signed-in", notes: states[name] } : null;
}

function errorMessage(error: ApiError): string {
  return error.code === "FORBIDDEN" ? "Esta conta não tem acesso a esta API." : error.message;
}

function RequestId({ error }: { error: ApiError }) {
  return error.requestId ? <p className="muted-small">Código do pedido: <code>{error.requestId}</code></p> : null;
}

function StatePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="state-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function SignedInNotes({ preview }: { preview: State | null }) {
  const isPreview = preview !== null;
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<ApiError | string | null>(null);

  // 401 volta para "signed-out"; o componente desmonta e para de pedir dados.
  const fail = useCallback((error: ApiError, show: (error: ApiError) => void) => {
    if (error.code === "UNAUTHORIZED") expireSession();
    else show(error);
  }, []);

  useEffect(() => {
    if (isPreview) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    listNotes({ signal: controller.signal })
      .then((page) => setState({ status: "ready", items: page.items, nextCursor: page.nextCursor }))
      .catch((error: ApiError) => { if (!controller.signal.aborted) fail(error, (error) => setState({ status: "error", error })); });
    return () => controller.abort();
  }, [attempt, isPreview, fail]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await listNotes({ cursor: state.nextCursor });
      setState({ status: "ready", items: [...state.items, ...page.items], nextCursor: page.nextCursor });
    } catch (error) {
      fail(error as ApiError, (error) => setState({ status: "error", error }));
    }
  }, [state, fail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return setFormError("Informe um título.");
    setSaving(true);
    setFormError(null);
    try {
      const note = await createNote({ title: trimmed });
      navigate(`/notes/${note.id}`);
    } catch (error) {
      fail(error as ApiError, setFormError);
      setSaving(false);
    }
  }

  const view = preview ?? state;

  return (
    <>
      <div className="notes-toolbar">
        <span>{view.status === "ready" ? `${view.items.length} ${view.items.length === 1 ? "nota" : "notas"}` : "Suas notas"}</span>
        <button type="button" className="button button-secondary" onClick={() => void signOut()} disabled={isPreview}>Sair</button>
      </div>

      <form className="note-form" onSubmit={submit} aria-labelledby="note-form-title">
        <h2 id="note-form-title">Nova nota</h2>
        <label htmlFor="note-title">Título</label>
        <input id="note-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoComplete="off" aria-describedby={formError ? "note-form-error" : undefined} />
        {formError && (
          <div className="form-error" id="note-form-error" role="alert">
            <p>{typeof formError === "string" ? formError : errorMessage(formError)}</p>
            {typeof formError !== "string" && <RequestId error={formError} />}
          </div>
        )}
        <button type="submit" className="button" disabled={saving || isPreview}>{saving ? "Criando…" : "Criar e abrir no editor"}</button>
      </form>

      <section aria-live="polite" aria-busy={view.status === "loading"}>
        {view.status === "loading" && (
          <div className="note-skeletons" role="status">
            <span className="visually-hidden">Carregando notas…</span>
            {[0, 1, 2].map((index) => <div className="note-skeleton" key={index} aria-hidden="true" />)}
          </div>
        )}

        {view.status === "error" && (
          <StatePanel title="Não foi possível carregar as notas">
            <p>{errorMessage(view.error)}</p>
            <RequestId error={view.error} />
            <button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Tentar de novo</button>
          </StatePanel>
        )}

        {view.status === "ready" && view.items.length === 0 && (
          <StatePanel title="Nenhuma nota ainda">
            <p>Crie a primeira nota acima; ela aparece aqui com título, tags e data de edição.</p>
          </StatePanel>
        )}

        {view.status === "ready" && view.items.length > 0 && (
          <>
            <ul className="note-list">
              {view.items.map((note) => (
                <li key={note.id}>
                  <Link className="note-row" to={`/notes/${note.id}`}>
                    <strong>{note.title}</strong>
                    <span className="note-meta">
                      {note.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                      <time dateTime={note.updatedAt}>{dateFormat.format(new Date(note.updatedAt))}</time>
                    </span>
                  </Link>
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
    </>
  );
}

export default function NotesPage() {
  usePageTitle("Notas");
  const [searchParams] = useSearchParams();
  const preview = previewState(searchParams.get("estado"));
  const auth = useAuth();
  const status = preview?.auth ?? auth.status;
  const signingIn = !preview && auth.signingIn;

  return (
    <div className="feature-page notes-page">
      <div className="eyebrow">NOTAS</div>
      <h1>Notas<em>.</em></h1>
      <p className="lead">Ideias, páginas e conexões em um lugar.</p>

      {status === "checking" && (
        <div className="notes-state" role="status">
          <StatePanel title="Verificando a conta…"><p>Isso leva só um instante.</p></StatePanel>
        </div>
      )}

      {status === "unsupported" && (
        <div className="notes-state">
          <StatePanel title="Login só no app desktop">
            <p>Abra o miupy notes no app desktop para entrar com Google e ver suas notas. Neste navegador, a tela não conversa com a API.</p>
          </StatePanel>
        </div>
      )}

      {status === "signed-out" && (
        <div className="notes-state">
          <StatePanel title="Conta não conectada">
            <p>Entre com sua conta Google para ver e criar notas. O login abre o navegador do sistema.</p>
            {!preview && auth.error && <p className="form-error" role="alert">{auth.error}</p>}
            <button type="button" className="button" onClick={() => { if (!preview) void signIn(); }} disabled={signingIn}>
              {signingIn ? "Aguardando o navegador…" : "Entrar com Google"}
            </button>
          </StatePanel>
        </div>
      )}

      {status === "signed-in" && <SignedInNotes preview={preview?.notes ?? null} />}
    </div>
  );
}

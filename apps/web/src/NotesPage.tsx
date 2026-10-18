import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SkeletonBody } from "./components/Skeleton";
import { ApiError } from "./lib/api-client";
import { signIn, signOut, useAuth, type AuthStatus } from "./lib/auth";
import { useCreateNote, useNotesList } from "./lib/notes-queries";
import type { NoteOutput } from "./lib/notes-api";
import { usePageTitle } from "./lib/use-page-title";

type PreviewNotes = { status: "loading" } | { status: "ready"; items: NoteOutput[]; nextCursor: string | null } | { status: "error"; error: ApiError };
type Preview = { auth: AuthStatus; notes: PreviewNotes };
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });

function previewState(name: string | null): Preview | null {
  if (!import.meta.env.DEV || !name) return null;
  const now = new Date().toISOString();
  const sample = (id: string, title: string, tags: string[]): NoteOutput => ({ id, title, body: "", tags, createdAt: now, updatedAt: now, version: 1 });
  const states: Record<string, PreviewNotes> = {
    carregando: { status: "loading" },
    vazio: { status: "ready", items: [], nextCursor: null },
    erro: { status: "error", error: new ApiError("INTERNAL_ERROR", "Erro interno.", 500, "00000000-0000-4000-8000-000000000000") },
    lista: { status: "ready", nextCursor: "exemplo", items: [sample("00000000-0000-4000-8000-000000000001", "Nota de exemplo", ["exemplo"]), sample("00000000-0000-4000-8000-000000000002", "Outra nota de exemplo com um título mais longo para testar a quebra de linha", [])] },
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
  return <div className="state-panel"><strong>{title}</strong>{children}</div>;
}

function SignedInNotes({ preview }: { preview: PreviewNotes | null }) {
  const query = useNotesList(preview === null);
  const create = useCreateNote();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<ApiError | string | null>(null);
  const isPreview = preview !== null;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const queryError = query.error instanceof ApiError ? query.error : new ApiError("UNKNOWN_ERROR", "Algo deu errado. Tente de novo.");
  const view = preview ?? (query.data ? { status: "ready" as const, items, nextCursor: query.hasNextPage ? "cached" : null } : query.isError ? { status: "error" as const, error: queryError } : { status: "loading" as const });
  const moreError = query.isFetchNextPageError ? queryError : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return setFormError("Informe um título.");
    setFormError(null);
    try {
      const note = await create.mutateAsync({ title: trimmed });
      navigate(`/notes/${note.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code !== "UNAUTHORIZED") setFormError(error);
    }
  }

  return <>
    <div className="notes-toolbar">
      <div className="notes-toolbar-status">
        <span>{view.status === "ready" ? `${view.items.length} ${view.items.length === 1 ? "nota" : "notas"}${view.nextCursor ? " carregadas" : ""}` : "Suas notas"}</span>
        {view.status === "ready" && !isPreview && query.isFetching && !query.isFetchingNextPage && <span className="refresh-status" role="status">Atualizando…</span>}
      </div>
      <button type="button" className="button button-secondary" onClick={() => void signOut()} disabled={isPreview}>Sair</button>
    </div>
    <form className="note-form" onSubmit={submit} aria-labelledby="note-form-title"><h2 id="note-form-title">Nova nota</h2><div className="note-form-fields"><label htmlFor="note-title">Título</label><input id="note-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoComplete="off" aria-describedby={formError ? "note-form-error" : undefined} /><button type="submit" className="button" disabled={create.isPending || isPreview}>{create.isPending ? "Criando…" : "Criar e abrir"}</button></div>{formError && <div className="form-error" id="note-form-error" role="alert"><p>{typeof formError === "string" ? formError : errorMessage(formError)}</p>{typeof formError !== "string" && <RequestId error={formError} />}</div>}</form>
    <section aria-busy={view.status === "loading"}>
      {view.status === "loading" && <SkeletonBody label="Carregando notas…" cards={4} cardHeight={54} />}
      {view.status === "error" && <StatePanel title="Não foi possível carregar as notas"><p>{errorMessage(view.error)}</p><RequestId error={view.error} /><button type="button" className="button button-secondary" onClick={() => void query.refetch()} disabled={isPreview}>Tentar de novo</button></StatePanel>}
      {view.status === "ready" && <>{view.items.length === 0 ? <StatePanel title="Nenhuma nota ainda"><p>Crie a primeira nota acima; ela aparece aqui com título, tags e data de edição.</p></StatePanel> : <ul className="note-list">{view.items.map((note) => <li key={note.id}><Link className="note-row" to={`/notes/${note.id}`}><strong>{note.title}</strong><span className="note-meta">{note.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}<time dateTime={note.updatedAt}>{dateFormat.format(new Date(note.updatedAt))}</time></span></Link></li>)}</ul>}{moreError && <div className="form-error" role="alert"><p>{errorMessage(moreError)}</p><RequestId error={moreError} /></div>}{view.nextCursor && <button type="button" className="button button-secondary load-more" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage || isPreview}>{query.isFetchingNextPage ? "Carregando…" : moreError ? "Tentar de novo" : "Carregar mais"}</button>}</>}
    </section>
  </>;
}

export default function NotesPage() {
  usePageTitle("Notas");
  const [searchParams] = useSearchParams();
  const preview = previewState(searchParams.get("estado"));
  const auth = useAuth();
  const status = preview?.auth ?? auth.status;
  return <div className="feature-page notes-page"><div className="eyebrow">ACERVO PESSOAL</div><h1>Notas<em>.</em></h1><p className="lead">Ideias, páginas e conexões em um lugar.</p>
    {status === "checking" && <div className="notes-state"><SkeletonBody label="Verificando a conta…" lines={2} cards={1} cardHeight={120} /></div>}
    {status === "unsupported" && <div className="notes-state"><StatePanel title="Login só no app desktop"><p>Abra o miupy notes no app desktop para entrar com Google e ver suas notas. Neste navegador, a tela não conversa com a API.</p></StatePanel></div>}
    {status === "signed-out" && <div className="notes-state"><StatePanel title="Conta não conectada"><p>Entre com sua conta Google para ver e criar notas. O login abre o navegador do sistema.</p>{!preview && auth.error && <p className="form-error" role="alert">{auth.error}</p>}<button type="button" className="button" onClick={() => { if (!preview) void signIn(); }} disabled={auth.signingIn || !!preview}>{auth.signingIn ? "Aguardando o navegador…" : "Entrar com Google"}</button></StatePanel></div>}
    {status === "signed-in" && <SignedInNotes preview={preview?.notes ?? null} />}
  </div>;
}

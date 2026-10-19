import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2, Settings, Type } from "lucide-react";
import LiveMarkdownEditor, { type LiveMarkdownEditorHandle } from "./components/LiveMarkdownEditor";
import TagInput from "./components/TagInput";
import { SkeletonBody } from "./components/Skeleton";
import type { ApiError } from "./lib/api-client";
import { getAuthSessionVersion, useAuth } from "./lib/auth";
import { editorStyle, setEditorPreferences, useEditorPreferences } from "./lib/editor-preferences";
import { getNote, type NoteOutput } from "./lib/notes-api";
import { changes, toDraft, MAX_BODY, MAX_TAG, MAX_TAGS, MAX_TITLE, type Draft, type EntryView } from "./lib/notes-autosave";
import { detectEol, type Eol } from "./lib/notes-markdown";
import { useDeleteNote, useNote } from "./lib/notes-queries";
import { notesSaver } from "./lib/notes-saver";
import { usePageTitle } from "./lib/use-page-title";
import "./editor.css";

const AUTOSAVE_DELAY_MS = 1200;

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "invalid"; message: string }
  | { status: "conflict" }
  | { status: "error"; error: ApiError };

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const countFormat = new Intl.NumberFormat("pt-BR");

// Só em desenvolvimento: `#/notes/<id>?estado=editor` abre uma nota de exemplo (`novo`: nota recém-criada)
// sem API nem login. Nada é gravado.
function previewNote(name: string | null): NoteOutput | null {
  if (!import.meta.env.DEV || (name !== "editor" && name !== "novo")) return null;
  const now = new Date().toISOString();
  const id = "00000000-0000-4000-8000-000000000001";
  if (name === "novo") return { id, title: "Sem título", body: "", tags: [], folderId: null, createdAt: now, updatedAt: now, version: 1 };
  const body = [
    "# Nota de exemplo", "", "Texto com **negrito**, _itálico_, ~~riscado~~, `código` e [um link](https://example.com).", "",
    "## Listas", "", "- primeiro item", "- segundo item", "1. passo um", "2. passo dois", "", "- [ ] tarefa pendente", "- [x] tarefa feita", "",
    "> uma citação\n", "---", "", "```ts", "const soma = (a, b) => a + b;", "```", "", "| nome | valor | nota |", "|:-----|------:|:----:|", "| **a** | `1` | [site](https://example.com) |", "| b | 2 | |", "",
    `![logo de exemplo](${location.origin}/vite.svg)`, "", "![imagem fora do ar](https://invalid.example/nao-existe.png)", "",
  ].join("\n");
  return { id, title: "Nota de exemplo", body, tags: ["exemplo", "markdown"], folderId: null, createdAt: now, updatedAt: now, version: 1 };
}

export default function NoteEditorPage() {
  const { status } = useAuth();
  // A tela perde o estado local ao trocar de sessão; recuperar um rascunho exige carregar a nota autorizada.
  return <NoteEditorSession key={`${status}:${getAuthSessionVersion()}`} />;
}

function NoteEditorSession() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const sample = useMemo(() => previewNote(searchParams.get("estado")), [searchParams]);
  const editorRef = useRef<LiveMarkdownEditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noteQuery = useNote(id);
  const deleteMutation = useDeleteNote();
  const preferences = useEditorPreferences();
  const [note, setNote] = useState<NoteOutput | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Estado de gravação vem da fila (lib/notes-saver.ts), que sobrevive à tela; `invalid` é só desta tela.
  const [view, setView] = useState<EntryView | undefined>();
  const [invalid, setInvalid] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [source, setSource] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const initializedId = useRef("");
  const eol = useRef<Eol>("\n");
  const latest = useRef({ note, draft });
  latest.current = { note, draft };
  // Nota recém-criada: o foco vai para o título, não para o texto.
  // Valor fixo desde a abertura: mudar `autoFocus` depois faria o editor roubar o foco do título.
  const bodyAutoFocus = useRef(false);
  const focusTitle = useRef((location.state as { focusTitle?: boolean } | null)?.focusTitle === true);

  usePageTitle(draft?.title.trim() || "Editor");

  // Uma revalidação em segundo plano nunca substitui o rascunho aberto.
  useEffect(() => {
    if (initializedId.current !== id) {
      initializedId.current = id;
      setNote(null);
      setDraft(null);
    }
    const loaded = sample ?? noteQuery.data;
    if (!loaded || (latest.current.note?.id === loaded.id && draft)) return;
    // Texto não gravado de uma visita anterior (falha, conflito, PATCH em andamento) volta no lugar da versão do servidor.
    const attached = sample ? { note: loaded, restored: null } : notesSaver.attach(loaded);
    eol.current = attached.restored?.eol ?? detectEol(attached.note.body);
    bodyAutoFocus.current = !focusTitle.current && !attached.restored && !attached.note.body;
    setNote(attached.note);
    setDraft(attached.restored ? attached.restored.draft : toDraft(attached.note));
    setRecovered(attached.restored !== null);
    setInvalid(null);
  }, [id, sample, noteQuery.data, draft]);

  // Acompanha a fila desta nota: nova versão confirmada, gravando, erro, conflito.
  const ready = !!note && !!draft;
  useEffect(() => {
    if (sample || !ready) return;
    const sync = () => {
      const current = notesSaver.view(id);
      if (!current) return;
      setView(current);
      // Só a versão desta nota entra no estado: o resultado de outra nota nunca chega aqui.
      setNote((previous) => (previous && previous.id === current.base.id && previous.version !== current.base.version ? current.base : previous));
    };
    sync();
    return notesSaver.subscribe(id, sync);
  }, [id, sample, ready]);

  useEffect(() => {
    if (!ready || !focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus();
    titleRef.current?.select();
    // Atualizar a página não deve devolver o foco ao título.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [ready, navigate, location.pathname, location.search]);

  /** Entrega o texto atual à fila e devolve `true` quando não resta nada a salvar (nem erro ou conflito). */
  const persist = useCallback(async (leaving = false): Promise<boolean> => {
    const { note: current, draft: pending } = latest.current;
    if (!current || !pending || sample) return false;
    const result = notesSaver.submit(current.id, pending, eol.current, { leaving });
    if (result.status === "invalid") {
      if (!leaving) setInvalid(result.message);
      return false;
    }
    if (!leaving) setInvalid(null);
    return notesSaver.flush(current.id);
  }, [sample]);

  const dirty = !!note && !!draft && changes(note, draft, eol.current) !== null;
  const save: SaveState = view?.blocked ? { status: "conflict" }
    : invalid ? { status: "invalid", message: invalid }
    : view?.sending ? { status: "saving" }
    : view?.error ? { status: "error", error: view.error }
    : { status: "idle" };
  const blocked = save.status === "conflict";
  // Ao sair após excluir, não há o que gravar.
  const deletedRef = useRef(false);

  // Salva sozinho após uma pausa na digitação; ao terminar um envio, `note` muda e reavalia.
  useEffect(() => {
    if (!dirty || blocked) return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, note, dirty, blocked, persist]);

  // Ao trocar de nota (barra lateral) ou fechar a tela, o texto atual vai para a fila, que termina a gravação
  // mesmo sem esta tela; se falhar ou houver conflito, ele fica guardado em memória e volta ao reabrir a nota.
  useEffect(() => () => {
    if (latest.current.note && !deletedRef.current) void persist(true);
  }, [id, persist]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(next: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setInvalid(null);
  }

  /** Escolha do usuário: troca o texto local pela versão do servidor (o texto guardado é descartado). */
  async function reloadSaved() {
    try {
      const fresh = await getNote(id);
      notesSaver.reset(fresh);
      eol.current = detectEol(fresh.body);
      setNote(fresh);
      setDraft(toDraft(fresh));
      setRecovered(false);
      setInvalid(null);
    } catch {
      // A tela continua em conflito; o usuário pode tentar de novo.
    }
  }

  // Em conflito ou com erro, o texto continua guardado na fila; sair não o descarta.
  async function goBack() {
    if (dirty && !blocked && !(await persist())) return;
    navigate("/notes");
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync(id);
      deletedRef.current = true;
      notesSaver.discard(id);
      navigate("/notes", { replace: true });
    } catch (error) {
      setDeleting(false);
      setDeleteError((error as ApiError).message);
    }
  }

  if (auth.status !== "signed-in" && !sample) {
    return (
      <div className="feature-page">
        <div className="eyebrow">EDITOR</div>
        <h1>Editor<em>.</em></h1>
        <p className="lead">Entre com sua conta Google na tela de notas para editar.</p>
        <Link className="text-link" to="/notes">Ir para Notas</Link>
      </div>
    );
  }

  if (!note || !draft) {
    const error = noteQuery.error as ApiError | null;
    const notFound = error?.code === "NOT_FOUND" || error?.code === "VALIDATION_ERROR";
    return (
      <div className="feature-page">
        <div className="eyebrow">EDITOR</div>
        {!error ? (
          <SkeletonBody label="Carregando nota" lines={3} cards={1} cardHeight={320} />
        ) : (
          <div className="state-panel">
            <strong>{notFound ? "Nota não encontrada" : "Não foi possível abrir a nota"}</strong>
            {!notFound && <p>{error.message}</p>}
            <Link className="text-link" to="/notes">Voltar para Notas</Link>
          </div>
        )}
      </div>
    );
  }

  const status = save.status === "saving" ? "Salvando…"
    : save.status === "invalid" ? save.message
    : save.status === "conflict" ? "Conflito: esta nota mudou em outro lugar."
    : save.status === "error" ? (save.error.code === "FORBIDDEN" ? "Esta conta não tem acesso a esta API." : `Não foi salvo: ${save.error.message}`)
    : dirty ? "Alterações não salvas"
    : `Salvo às ${timeFormat.format(new Date(note.updatedAt))}`;
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;

  return (
    <div className={`editor-page page-fill editor-theme-${preferences.colorTheme} chip-${preferences.chipStyle}`} style={editorStyle(preferences)}>
      <div className="editor-header">
        <button type="button" className="tool-button" aria-label="Voltar às notas" title="Voltar às notas" onClick={() => void goBack()}><ArrowLeft size={18} /></button>
        <span className={`save-status${save.status === "conflict" || save.status === "error" || save.status === "invalid" ? " save-status-alert" : ""}`} role="status" aria-live="polite">{status}</span>
        <div className="editor-actions" role="group" aria-label="Ações da nota">
          <button type="button" className="tool-button" aria-label="Salvar" title="Salvar (Ctrl+S)" onClick={() => void persist()} disabled={!dirty || save.status === "saving" || blocked}><Save size={18} /></button>
          <button type="button" className="tool-button" aria-label="Alternar fonte dos títulos" title="Alternar fonte dos títulos" onClick={() => setEditorPreferences({ headingFont: preferences.headingFont === "serif" ? "sans" : "serif" })}><Type size={18} /></button>
          <button type="button" className="tool-button" aria-label="Configurações" title="Configurações" onClick={() => navigate("/settings")}><Settings size={18} /></button>
          <button type="button" className="tool-button" aria-label="Excluir nota" title="Excluir nota" onClick={() => setConfirmDelete(true)} disabled={deleting}><Trash2 size={18} /></button>
        </div>
      </div>

      {confirmDelete && (
        <div className="state-panel editor-banner" role="alertdialog" aria-labelledby="delete-title">
          <strong id="delete-title">Excluir esta nota?</strong>
          <p>A exclusão é definitiva: ainda não há lixeira.</p>
          <div className="editor-actions">
            <button type="button" className="button" onClick={() => void remove()} disabled={deleting}>{deleting ? "Excluindo…" : "Excluir definitivamente"}</button>
            <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancelar</button>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="state-panel editor-banner" role="alert">
          <strong>Não foi possível excluir a nota</strong>
          <p>{deleteError}</p>
        </div>
      )}

      {recovered && (dirty || save.status !== "idle") && (
        <div className="state-panel editor-banner" role="status">
          <strong>Rascunho recuperado</strong>
          <p>Estas alterações não estavam gravadas quando você saiu desta nota{save.status === "saving" ? "; estão sendo enviadas agora." : save.status === "conflict" ? ", e a nota mudou em outro lugar." : save.status === "error" ? ", e o envio falhou. O texto continua aqui; tente salvar de novo." : ". Elas serão enviadas em instantes."}</p>
        </div>
      )}

      {save.status === "conflict" && (
        <div className="state-panel editor-banner" role="alert">
          <strong>Esta nota foi alterada em outro lugar</strong>
          <p>O salvamento automático parou para não sobrescrever a outra versão. Seu texto continua guardado nesta sessão, mesmo se você sair; copie o que precisar antes de recarregar, pois recarregar o descarta.</p>
          <button type="button" className="button button-secondary" onClick={() => void reloadSaved()}>Recarregar a versão salva</button>
        </div>
      )}

      <label className="visually-hidden" htmlFor="editor-title">Título</label>
      <input
        ref={titleRef}
        id="editor-title"
        className="editor-title"
        value={draft.title}
        onChange={(event) => edit({ title: event.target.value })}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); editorRef.current?.focus(); } }}
        maxLength={MAX_TITLE}
        placeholder="Título"
        autoComplete="off"
      />
      {preferences.showTags && (
        <div className="editor-meta">
          <TagInput value={draft.tags} onChange={(tags) => edit({ tags })} maxTags={MAX_TAGS} maxLength={MAX_TAG} />
        </div>
      )}

      <LiveMarkdownEditor
        ref={editorRef}
        value={draft.body}
        onChange={(body) => edit({ body })}
        onSave={() => void persist()}
        source={source}
        onSourceChange={setSource}
        autoFocus={bodyAutoFocus.current}
      />

      <div className="editor-footer muted-small">
        <span>{countFormat.format(words)} {words === 1 ? "palavra" : "palavras"} · {countFormat.format(draft.body.length)} / {countFormat.format(MAX_BODY)} caracteres</span>
        <span>Ctrl+S salva · Ctrl+Enter alterna tarefa · versão {note.version}</span>
      </div>
    </div>
  );
}

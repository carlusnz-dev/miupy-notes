import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2, Settings, Type } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import LiveMarkdownEditor, { type LiveMarkdownEditorHandle } from "./components/LiveMarkdownEditor";
import TagInput from "./components/TagInput";
import { SkeletonBody } from "./components/Skeleton";
import { ApiError } from "./lib/api-client";
import { expireSession, useAuth } from "./lib/auth";
import { editorStyle, setEditorPreferences, useEditorPreferences } from "./lib/editor-preferences";
import { getNote, updateNote, type NoteOutput } from "./lib/notes-api";
import { saveNote, toDraft, changes, MAX_BODY, MAX_TAG, MAX_TAGS, MAX_TITLE, type Draft } from "./lib/notes-autosave";
import { detectEol, type Eol } from "./lib/notes-markdown";
import { cacheSavedNote, useDeleteNote, useNote } from "./lib/notes-queries";
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
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const sample = useMemo(() => previewNote(searchParams.get("estado")), [searchParams]);
  const editorRef = useRef<LiveMarkdownEditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const noteQuery = useNote(id);
  const deleteMutation = useDeleteNote();
  const preferences = useEditorPreferences();
  const [note, setNote] = useState<NoteOutput | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [source, setSource] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // ID da nota com PATCH em andamento: salvar a nota B não espera nem é bloqueado pela resposta da nota A.
  const saving = useRef(new Set<string>());
  const initializedId = useRef("");
  const eol = useRef<Eol>("\n");
  const latest = useRef({ note, draft });
  latest.current = { note, draft };
  // Nota recém-criada: o foco vai para o título, não para o texto.
  // Valor fixo desde a abertura: mudar `autoFocus` depois faria o editor roubar o foco do título.
  const bodyAutoFocus = useRef(false);
  const focusTitle = useRef((location.state as { focusTitle?: boolean } | null)?.focusTitle === true);

  usePageTitle(draft?.title.trim() || "Editor");

  const fail = useCallback((error: ApiError) => {
    if (error.code === "UNAUTHORIZED") expireSession();
    else if (error.code === "CONFLICT") setSave({ status: "conflict" });
    else setSave({ status: "error", error });
  }, []);

  // Uma revalidação em segundo plano nunca substitui o rascunho aberto.
  useEffect(() => {
    if (initializedId.current !== id) {
      initializedId.current = id;
      setNote(null);
      setDraft(null);
    }
    const loaded = sample ?? noteQuery.data;
    if (!loaded || (latest.current.note?.id === loaded.id && draft)) return;
    eol.current = detectEol(loaded.body);
    bodyAutoFocus.current = !focusTitle.current && !loaded.body;
    setNote(loaded);
    setDraft(toDraft(loaded));
    setSave({ status: "idle" });
  }, [id, sample, noteQuery.data, draft]);

  const ready = !!note && !!draft;
  useEffect(() => {
    if (!ready || !focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus();
    titleRef.current?.select();
    // Atualizar a página não deve devolver o foco ao título.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [ready, navigate, location.pathname, location.search]);

  /**
   * Devolve `true` quando não resta nada a salvar. A regra de gravação (uma nota por vez, resposta obsoleta,
   * salvar ao sair) vive em lib/notes-autosave.ts e tem testes; aqui só se aplica o resultado ao estado.
   */
  const persist = useCallback(async (leaving = false): Promise<boolean> => {
    const { note: current, draft: pending } = latest.current;
    if (!current || !pending || sample) return false;
    if (!leaving) setSave({ status: "saving" });
    const result = await saveNote({
      note: current, draft: pending, eol: eol.current, leaving, inFlight: saving.current, update: updateNote,
      openNoteId: () => latest.current.note?.id, formatCount: countFormat.format,
    });
    switch (result.status) {
      case "busy": return false;
      case "clean": if (!leaving) setSave({ status: "idle" }); return true;
      case "invalid": if (!leaving) setSave({ status: "invalid", message: result.message }); return false;
      case "failed": if (!result.stale) fail(result.error); return false;
      case "saved": {
        // O cache da nota certa sempre recebe o resultado; o estado da tela só se ainda estamos nela.
        cacheSavedNote(client, result.note);
        if (result.stale) return true;
        latest.current = { note: result.note, draft: latest.current.draft };
        setNote(result.note);
        setSave({ status: "idle" });
        return changes(result.note, latest.current.draft ?? pending, eol.current) === null;
      }
    }
  }, [fail, sample, client]);

  const dirty = !!note && !!draft && changes(note, draft, eol.current) !== null;
  const blocked = save.status === "conflict";
  // Não gravar ao sair quando há conflito (atualizado a cada render) ou a nota acabou de ser excluída.
  const conflictRef = useRef(false);
  conflictRef.current = blocked;
  const deletedRef = useRef(false);

  // Salva sozinho após uma pausa na digitação; ao terminar um envio, `note` muda e reavalia.
  useEffect(() => {
    if (!dirty || blocked) return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, note, dirty, blocked, persist]);

  // Ao trocar de nota (barra lateral) ou fechar a tela, o rascunho pendente é gravado em vez de perdido.
  // O cleanup roda com o estado da nota que está saindo; em conflito nada é enviado.
  useEffect(() => () => {
    if (latest.current.note && !conflictRef.current && !deletedRef.current) void persist(true);
  }, [id, persist]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(next: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    if (save.status === "invalid" || save.status === "error") setSave({ status: "idle" });
  }

  async function reloadSaved() {
    try {
      const fresh = await getNote(id);
      eol.current = detectEol(fresh.body);
      setNote(fresh);
      setDraft(toDraft(fresh));
      setSave({ status: "idle" });
    } catch (error) {
      fail(error as ApiError);
    }
  }

  // Em conflito, sair descarta o rascunho local, como "Recarregar".
  async function goBack() {
    if (dirty && !blocked && !(await persist())) return;
    navigate("/notes");
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync(id);
      deletedRef.current = true;
      navigate("/notes", { replace: true });
    } catch (error) {
      setDeleting(false);
      fail(error as ApiError);
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

      {save.status === "conflict" && (
        <div className="state-panel editor-banner" role="alert">
          <strong>Esta nota foi alterada em outro lugar</strong>
          <p>O salvamento automático parou para não sobrescrever a outra versão. Copie o que precisar antes de recarregar.</p>
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

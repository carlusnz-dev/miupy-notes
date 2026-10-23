import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2, Settings, Type, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LiveMarkdownEditor, { type LiveMarkdownEditorHandle } from "./components/LiveMarkdownEditor";
import TagInput from "./components/TagInput";
import ConfirmDialog from "./components/ConfirmDialog";
import { SkeletonBody } from "./components/Skeleton";
import type { ApiError } from "./lib/api-client";
import { getAuthSessionVersion, useAuth } from "./lib/auth";
import { editorStyle, setEditorPreferences, useEditorPreferences } from "./lib/editor-preferences";
import { getNote, type NoteOutput } from "./lib/notes-api";
import { toDraft, MAX_BODY, MAX_TAG, MAX_TAGS, MAX_TITLE, type Draft, type EntryView } from "./lib/notes-autosave";
import { describeSave } from "./lib/notes-autosave-status";
import { detectEol, type Eol } from "./lib/notes-markdown";
import { useDeleteNote, useNote } from "./lib/notes-queries";
import { isLocalReadFailure } from "./lib/notes-autosave";
import { notesSaver, sessionIdle } from "./lib/notes-saver";
import { usePageTitle } from "./lib/use-page-title";
import "./editor.css";

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
  // Estado de gravação vem da fila (lib/notes-saver.ts), que sobrevive à tela e decide quando enviar.
  const [view, setView] = useState<EntryView | undefined>();
  const [recovered, setRecovered] = useState(false);
  // Falha ao abrir o rascunho local ou a sessão: a tela não edita (nem sobrescreve) até uma decisão do usuário.
  const [attachError, setAttachError] = useState<{ message: string; local: boolean } | null>(null);
  const [attachTry, setAttachTry] = useState(0);
  const ignoreLocal = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState(false);
  const [reading, setReading] = useState(false);
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
    // Texto não gravado de uma visita anterior (ou de antes de fechar o app) volta no lugar da versão do servidor.
    let cancelled = false;
    const open = async () => {
      if (sample) return { note: loaded, restored: null };
      await sessionIdle();
      return notesSaver.attach(loaded, { ignoreLocal: ignoreLocal.current });
    };
    void open().then((attached) => {
      if (cancelled) return;
      const restoredDraft = attached.restored ? attached.restored.draft : toDraft(attached.note);
      eol.current = attached.restored?.eol ?? detectEol(attached.note.body);
      bodyAutoFocus.current = !focusTitle.current && !attached.restored && !attached.note.body;
      latest.current = { note: attached.note, draft: restoredDraft };
      setNote(attached.note);
      setDraft(restoredDraft);
      setRecovered(attached.restored !== null);
      setAttachError(null);
    }, (error: unknown) => {
      if (cancelled) return;
      const local = isLocalReadFailure(error);
      setAttachError({ local, message: local ? "Não foi possível ler os rascunhos guardados neste computador. Para não sobrescrever um texto não enviado, a nota não foi aberta para edição." : "Não foi possível preparar a sessão desta nota." });
    });
    return () => { cancelled = true; };
  }, [id, sample, noteQuery.data, draft, attachTry]);

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

  /** "Salvar agora": a fila envia assim que o scheduler permitir; `true` quando a nota ficou sincronizada. */
  const persist = useCallback(async (): Promise<boolean> => {
    const { note: current } = latest.current;
    if (!current || sample) return false;
    return notesSaver.flush(current.id);
  }, [sample]);

  useEffect(() => {
    if (!ready) return;
    function shortcut(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || document.querySelector("dialog[open]")) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void persist(); return; }
      const matches = preferences.readingShortcut === "Alt+R"
        ? event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "r"
        : (event.ctrlKey || event.metaKey) && !event.altKey && event.shiftKey === (preferences.readingShortcut === "Ctrl+Shift+E") && event.key.toLowerCase() === "e";
      if (matches) { event.preventDefault(); event.stopPropagation(); setReading(value => !value); }
    }
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [preferences.readingShortcut, ready, persist]);

  const save = describeSave(view, `Sincronizado às ${timeFormat.format(new Date(note?.updatedAt ?? 0))}`);
  const blocked = view?.status === "conflict";
  const busy = view?.status === "saving";
  const dirty = !!view?.snapshot;
  // Ao sair após excluir, não há o que gravar.
  const deletedRef = useRef(false);

  /** Cada alteração vai à fila na hora (mesmo inválida); o envio à API fica a cargo do scheduler. */
  function edit(next: Partial<Draft>) {
    const { note: current, draft: previous } = latest.current;
    if (!current || !previous) return;
    const updated = { ...previous, ...next };
    latest.current = { note: current, draft: updated };
    setDraft(updated);
    if (!sample) notesSaver.edit(current.id, updated, eol.current);
  }

  /** Escolha do usuário: troca o texto local pela versão do servidor (o texto guardado é descartado). */
  async function reloadSaved() {
    try {
      const fresh = await getNote(id);
      setNotice((await notesSaver.reset(fresh)) ? null : "Recarregado, mas o rascunho antigo não pôde ser removido deste computador; ele pode reaparecer depois.");
      eol.current = detectEol(fresh.body);
      setNote(fresh);
      setDraft(toDraft(fresh));
      setRecovered(false);
    } catch {
      // A tela continua em conflito; o usuário pode tentar de novo.
    }
  }

  // Sair não depende da rede: basta o texto estar protegido no disco; sem isso, tenta sincronizar antes.
  async function goBack() {
    if (!sample && dirty && !(await notesSaver.protect(id)) && !(await persist())) return;
    navigate("/notes");
  }

  async function remove() {
    setDeleting(true);
    try {
      // Nenhum PATCH novo sai durante a exclusão, e respostas tardias não recriam a nota.
      await notesSaver.hold(id);
      await deleteMutation.mutateAsync(id);
      deletedRef.current = true;
      if (!(await notesSaver.discard(id))) {
        // A tentativa pendente só existe nesta execução; não promete limpeza depois de reiniciar.
        setDeleting(false);
        setDeleteError("A nota foi excluída, mas o rascunho local não pôde ser removido agora. Tentaremos de novo no próximo login enquanto o app continuar aberto. Se você fechar o app antes, o rascunho poderá permanecer neste computador.");
        return;
      }
      navigate("/notes", { replace: true });
    } catch (error) {
      notesSaver.release(id);
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
    if (attachError) {
      return (
        <div className="feature-page">
          <div className="eyebrow">EDITOR</div>
          <div className="state-panel" role="alert">
            <strong>{attachError.local ? "Rascunho local ilegível" : "Não foi possível abrir a nota"}</strong>
            <p>{attachError.message}</p>
            <button type="button" className="button button-secondary" onClick={() => { ignoreLocal.current = false; setAttachError(null); setAttachTry((n) => n + 1); }}>Tentar de novo</button>
            {attachError.local && <button type="button" className="button button-secondary" onClick={() => { ignoreLocal.current = true; setAttachError(null); setAttachTry((n) => n + 1); }}>Abrir sem o rascunho local</button>}
            <Link className="text-link" to="/notes">Voltar para Notas</Link>
          </div>
        </div>
      );
    }
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

  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;

  return (
    <div className={`editor-page page-fill editor-theme-${preferences.colorTheme} chip-${preferences.chipStyle}`} style={editorStyle(preferences)}>
      <div className="editor-header">
        <button type="button" className="tool-button" aria-label="Voltar às notas" title="Voltar às notas" onClick={() => void goBack()}><ArrowLeft size={18} /></button>
        <span className={`save-status${save.alert ? " save-status-alert" : ""}`} role="status" aria-live="polite">{save.text}</span>
        <div className="editor-actions" role="group" aria-label="Ações da nota">
          <button type="button" className="tool-button" aria-label="Salvar" title="Salvar (Ctrl+S)" onClick={() => void persist()} disabled={!dirty || busy || blocked}><Save size={18} /></button>
          <button type="button" className="tool-button" aria-label="Modo leitura" aria-pressed={reading} title={`Modo leitura (${preferences.readingShortcut})`} onClick={() => setReading(value => !value)}><BookOpen size={18} /></button>
          <button type="button" className="tool-button" aria-label="Alternar fonte dos títulos" title="Alternar fonte dos títulos" onClick={() => setEditorPreferences({ headingFont: preferences.headingFont === "serif" ? "sans" : "serif" })}><Type size={18} /></button>
          <button type="button" className="tool-button" aria-label="Configurações" title="Configurações" onClick={() => navigate("/settings")}><Settings size={18} /></button>
          <button type="button" className="tool-button" aria-label="Excluir nota" title="Excluir nota" onClick={() => setConfirmDelete(true)} disabled={deleting}><Trash2 size={18} /></button>
        </div>
      </div>

      <ConfirmDialog open={confirmDelete} title="Excluir esta nota?" confirmLabel="Excluir definitivamente" busyLabel="Excluindo…" busy={deleting} error={deleteError} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
        <p>A exclusão é definitiva: ainda não há lixeira.</p>
      </ConfirmDialog>

      {recovered && (dirty || (view && view.status !== "synced")) && (
        <div className="state-panel editor-banner" role="status">
          <strong>Rascunho recuperado</strong>
          <p>Estas alterações não estavam gravadas quando você saiu desta nota{view?.status === "saving" ? "; estão sendo enviadas agora." : blocked ? ", e a nota mudou em outro lugar." : view?.status === "error" || view?.status === "offline" ? ", e o envio ainda não foi concluído. O texto continua guardado neste computador." : ". Elas serão enviadas em instantes."}</p>
        </div>
      )}

      {notice && <div className="state-panel editor-banner" role="alert"><p>{notice}</p></div>}

      {blocked && (
        <div className="state-panel editor-banner" role="alert">
          <strong>Esta nota foi alterada em outro lugar</strong>
          <p>O salvamento automático parou para não sobrescrever a outra versão. Seu texto continua guardado neste computador, mesmo se você sair; copie o que precisar antes de recarregar, pois recarregar o descarta.</p>
          <button type="button" className="button button-secondary" onClick={() => void reloadSaved()}>Recarregar a versão salva</button>
        </div>
      )}

      <label className="visually-hidden" htmlFor="editor-title">Título</label>
      {reading ? <h1 className="editor-title">{draft.title || "Sem título"}</h1> : <input
        ref={titleRef}
        id="editor-title"
        className="editor-title"
        value={draft.title}
        onChange={(event) => edit({ title: event.target.value })}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); editorRef.current?.focus(); } }}
        maxLength={MAX_TITLE}
        placeholder="Título"
        autoComplete="off"
      />}
      {preferences.showTags && !reading && (
        <div className="editor-meta">
          <TagInput value={draft.tags} onChange={(tags) => edit({ tags })} maxTags={MAX_TAGS} maxLength={MAX_TAG} />
        </div>
      )}

      {reading && <article className="markdown-preview note-reading" aria-label="Nota em modo leitura" tabIndex={0}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{draft.body}</ReactMarkdown></article>}
      {/* Manter o editor montado preserva seleção e histórico de desfazer durante a leitura. */}
      <div className="note-writing" hidden={reading} inert={reading}><LiveMarkdownEditor
        ref={editorRef}
        value={draft.body}
        onChange={(body) => edit({ body })}
        onSave={() => void persist()}
        source={source}
        onSourceChange={setSource}
        autoFocus={bodyAutoFocus.current}
      /></div>

      <div className="editor-footer muted-small">
        <span>{countFormat.format(words)} {words === 1 ? "palavra" : "palavras"} · {countFormat.format(draft.body.length)} / {countFormat.format(MAX_BODY)} caracteres</span>
        <span>{preferences.readingShortcut} alterna leitura · Ctrl+S salva · {!reading && "Ctrl+Enter alterna tarefa · "}versão {note.version}</span>
      </div>
    </div>
  );
}

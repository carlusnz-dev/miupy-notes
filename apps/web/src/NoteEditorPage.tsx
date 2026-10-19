import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as syntaxTags } from "@lezer/highlight";
import { ArrowLeft, Save, Trash2, Pencil, Columns2, Eye, Settings, Type, ChevronDown, ChevronRight, Bold, Italic, Strikethrough, Heading, List, ListOrdered, ListChecks, Quote, Code, SquareCode, Link as LinkIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ApiError } from "./lib/api-client";
import { expireSession, useAuth } from "./lib/auth";
import { getNote, updateNote, type NoteOutput } from "./lib/notes-api";
import { useDeleteNote, useNote, cacheSavedNote } from "./lib/notes-queries";
import { editorStyle, setEditorPreferences, useEditorPreferences } from "./lib/editor-preferences";
import { SkeletonBody } from "./components/Skeleton";
import "./editor.css";
import { usePageTitle } from "./lib/use-page-title";

// Limites iguais aos do contrato (apps/api/src/modules/notes/dto/input.ts).
const MAX_TITLE = 200;
const MAX_BODY = 100_000;
const MAX_TAGS = 20;
const MAX_TAG = 40;
const AUTOSAVE_DELAY_MS = 1200;

type Draft = { title: string; body: string; tags: string[] };
type Mode = "edit" | "split" | "preview";
type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "invalid"; message: string }
  | { status: "conflict" }
  | { status: "error"; error: ApiError };

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const countFormat = new Intl.NumberFormat("pt-BR");


// Só em desenvolvimento: `#/notes/<id>?estado=editor` abre uma nota de exemplo sem API nem login.
function previewNote(name: string | null): NoteOutput | null {
  if (!import.meta.env.DEV || name !== "editor") return null;
  const now = new Date().toISOString();
  const body = "## Exemplo\n\nTexto com **negrito**, _itálico_ e [um link](https://example.com).\n\n- [ ] tarefa\n- [x] feita\n\n> citação\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncódigo\n```\n";
  return { id: "00000000-0000-4000-8000-000000000001", title: "Nota de exemplo", body, tags: ["exemplo"], createdAt: now, updatedAt: now, version: 1 };
}

function toDraft(note: NoteOutput): Draft {
  return { title: note.title, body: note.body, tags: note.tags };
}

/** Só os campos alterados vão no PATCH; `null` quando não há o que salvar. */
function changes(note: NoteOutput, draft: Draft) {
  const title = draft.title.trim();
  const tags = draft.tags;
  const result: { title?: string; body?: string; tags?: string[] } = {};
  if (title !== note.title) result.title = title;
  if (draft.body !== note.body) result.body = draft.body;
  if (tags.join("\u0000") !== note.tags.join("\u0000")) result.tags = tags;
  return Object.keys(result).length ? result : null;
}

function validate(draft: Draft): string | null {
  const title = draft.title.trim();
  if (!title) return "Informe um título.";
  if (title.length > MAX_TITLE) return `O título passa de ${MAX_TITLE} caracteres.`;
  if (draft.body.length > MAX_BODY) return `O texto passa de ${countFormat.format(MAX_BODY)} caracteres.`;
  const tags = draft.tags;
  if (tags.length > MAX_TAGS) return `Use no máximo ${MAX_TAGS} tags.`;
  if (tags.some((tag) => tag.length > MAX_TAG)) return `Cada tag pode ter até ${MAX_TAG} caracteres.`;
  return null;
}

/** Envolve a seleção (ou insere o marcador vazio com o cursor no meio). */
function wrap(view: EditorView, before: string, after = before, placeholder = "") {
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to) || placeholder;
    const insert = `${before}${text}${after}`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length),
    };
  }));
  view.focus();
  return true;
}

/** Alterna um prefixo em cada linha da seleção (título, lista, citação, tarefa). */
function prefixLines(view: EditorView, prefix: string) {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let line = state.doc.lineAt(range.from).number; line <= state.doc.lineAt(range.to).number; line++) lines.add(line);
  }
  const all = [...lines].map((number) => state.doc.line(number));
  const remove = all.every((line) => line.text.startsWith(prefix));
  view.dispatch({
    changes: all.map((line) => (remove ? { from: line.from, to: line.from + prefix.length } : { from: line.from, insert: prefix })),
  });
  view.focus();
  return true;
}

function insertLink(view: EditorView) {
  return wrap(view, "[", "](https://)", "texto");
}

function insertCodeBlock(view: EditorView) {
  return wrap(view, "```\n", "\n```", "código");
}

const tools: Array<{ label: string; hint: string; run: (view: EditorView) => boolean; icon: typeof Bold }> = [
  { label: "Negrito", hint: "Ctrl+B", icon: Bold, run: (view) => wrap(view, "**", "**", "texto") },
  { label: "Itálico", hint: "Ctrl+I", icon: Italic, run: (view) => wrap(view, "_", "_", "texto") },
  { label: "Riscado", hint: "", icon: Strikethrough, run: (view) => wrap(view, "~~", "~~", "texto") },
  { label: "Título", hint: "", icon: Heading, run: (view) => prefixLines(view, "## ") },
  { label: "Lista", hint: "", icon: List, run: (view) => prefixLines(view, "- ") },
  { label: "Lista numerada", hint: "", icon: ListOrdered, run: (view) => prefixLines(view, "1. ") },
  { label: "Tarefa", hint: "", icon: ListChecks, run: (view) => prefixLines(view, "- [ ] ") },
  { label: "Citação", hint: "", icon: Quote, run: (view) => prefixLines(view, "> ") },
  { label: "Código", hint: "", icon: Code, run: (view) => wrap(view, "`", "`", "código") },
  { label: "Bloco de código", hint: "", icon: SquareCode, run: insertCodeBlock },
  { label: "Link", hint: "Ctrl+K", icon: LinkIcon, run: insertLink },
];

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--color-background)", color: "var(--color-text)", fontSize: "var(--editor-size)", height: "100%" },
  ".cm-content": { fontFamily: "var(--editor-font)", lineHeight: "1.7", padding: "16px 0", caretColor: "var(--color-text)" },
  ".cm-line": { padding: "0 18px" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto" },
}, { dark: true });

/** Links da prévia abrem no navegador do sistema; nunca navegam a janela do app. */
function PreviewLink({ href, children }: { href?: string; children?: ReactNode }) {
  const external = !!href && /^(https?:|mailto:)/i.test(href);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (!external || !href) return;
    if (isTauri()) void openUrl(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }
  return <a href={external ? href : undefined} onClick={open} rel="noopener noreferrer">{children}</a>;
}

export default function NoteEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const sample = useMemo(() => previewNote(searchParams.get("estado")), [searchParams]);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const previewRef = useRef<HTMLElement>(null);
  const client = useQueryClient();
  const noteQuery = useNote(id);
  const deleteMutation = useDeleteNote();
  const preferences = useEditorPreferences();
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState<NoteOutput | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [mode, setMode] = useState<Mode>(() => (window.matchMedia("(min-width: 1100px)").matches ? "split" : "edit"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saving = useRef(false);
  const initializedId = useRef("");
  const latest = useRef({ note, draft });
  latest.current = { note, draft };

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
    setNote(loaded);
    setDraft(toDraft(loaded));
    setSave({ status: "idle" });
  }, [id, sample, noteQuery.data, draft]);

  /** Devolve `true` quando não resta nada a salvar. */
  const persist = useCallback(async (): Promise<boolean> => {
    const { note: current, draft: pending } = latest.current;
    if (!current || !pending || saving.current || sample) return false;
    const invalid = validate(pending);
    if (invalid) {
      setSave({ status: "invalid", message: invalid });
      return false;
    }
    const patch = changes(current, pending);
    if (!patch) {
      setSave({ status: "idle" });
      return true;
    }
    saving.current = true;
    setSave({ status: "saving" });
    try {
      const updated = await updateNote(current.id, { version: current.version, ...patch });
      latest.current = { note: updated, draft: latest.current.draft };
      setNote(updated);
      cacheSavedNote(client, updated);
      setSave({ status: "idle" });
      return changes(updated, latest.current.draft ?? pending) === null;
    } catch (error) {
      fail(error as ApiError);
      return false;
    } finally {
      saving.current = false;
    }
  }, [fail, sample, client]);

  const dirty = !!note && !!draft && changes(note, draft) !== null;
  const blocked = save.status === "conflict";

  // Salva sozinho após uma pausa na digitação; ao terminar um envio, `note` muda e reavalia.
  useEffect(() => {
    if (!dirty || blocked) return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, note, dirty, blocked, persist]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const extensions = useMemo(() => [
    markdown(),
    syntaxHighlighting(HighlightStyle.define([{ tag: syntaxTags.heading, fontWeight: "700", color: "var(--color-text)" }])),
    EditorView.scrollMargins.of(() => ({ bottom: Math.round((editorRef.current?.view?.scrollDOM.clientHeight ?? 300) * .35) })),
    EditorView.updateListener.of((update) => { if (update.docChanged) syncPreview(update.view); }),
    EditorView.lineWrapping,
    editorTheme,
    EditorView.contentAttributes.of({ "aria-label": "Texto da nota em Markdown" }),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => { void persist(); return true; } },
      { key: "Mod-b", run: (view) => wrap(view, "**", "**", "texto") },
      { key: "Mod-i", run: (view) => wrap(view, "_", "_", "texto") },
      { key: "Mod-k", preventDefault: true, run: insertLink },
    ]),
  ], [persist]);

  function edit(next: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    if (save.status === "invalid" || save.status === "error") setSave({ status: "idle" });
  }

  function syncPreview(view: EditorView) {
    if (!previewRef.current) return;
    const scroller = view.scrollDOM;
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    previewRef.current.scrollTop = ratio * (previewRef.current.scrollHeight - previewRef.current.clientHeight);
  }

  function runTool(run: (view: EditorView) => boolean) {
    const view = editorRef.current?.view;
    if (view) run(view);
  }

  async function reloadSaved() {
    try {
      const fresh = await getNote(id);
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
          {([["edit", "Editar", Pencil], ["split", "Dividir", Columns2], ["preview", "Prévia", Eye]] as const).map(([value, label, Icon]) => <button key={value} type="button" className="tool-button mode-button" aria-label={label} title={label} aria-pressed={mode === value} onClick={() => setMode(value)}><Icon size={18} /></button>)}
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
      <input id="editor-title" className="editor-title" value={draft.title} onChange={(event) => edit({ title: event.target.value })} maxLength={MAX_TITLE} placeholder="Título" autoComplete="off" />
      <div className="editor-meta">
        <button type="button" className="tool-button editor-toggle" aria-expanded={preferences.toolbarExpanded} aria-controls="editor-extra" title="Expandir ou recolher formatação" onClick={() => setEditorPreferences({ toolbarExpanded: !preferences.toolbarExpanded })}>{preferences.toolbarExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Formatação e tags</button>
        {preferences.toolbarExpanded && <div id="editor-extra" className="editor-extra">
          <div className="editor-toolbar" role="toolbar" aria-label="Formatação Markdown"><div className="editor-tools">{tools.map((tool) => <button key={tool.label} type="button" className="tool-button" onClick={() => runTool(tool.run)} disabled={mode === "preview"} title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label} aria-label={tool.label}><tool.icon size={17} /></button>)}</div></div>
          {preferences.showTags && <div className="editor-tags"><span>Tags</span>{draft.tags.map((tag) => <span className="editor-chip" key={tag}>{tag}<button type="button" aria-label={`Remover tag ${tag}`} title={`Remover ${tag}`} onClick={() => edit({ tags: draft.tags.filter((item) => item !== tag) })}>×</button></span>)}<input aria-label="Adicionar tag" value={tagInput} maxLength={MAX_TAG} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); const tag = tagInput.trim(); if (tag && draft.tags.length < MAX_TAGS && !draft.tags.includes(tag)) edit({ tags: [...draft.tags, tag] }); setTagInput(""); } else if (event.key === "Backspace" && !tagInput && draft.tags.length) edit({ tags: draft.tags.slice(0, -1) }); }} placeholder="Adicionar tag…" autoComplete="off" /></div>}
        </div>}
      </div>

      <div className={`editor-panes editor-${mode}`}>
        {mode !== "preview" && (
          <div className="editor-pane">
            <CodeMirror
              ref={editorRef}
              onCreateEditor={(view) => view.scrollDOM.addEventListener("scroll", () => syncPreview(view), { passive: true })}
              value={draft.body}
              onChange={(body) => edit({ body })}
              extensions={extensions}
              theme="dark"
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, searchKeymap: false, foldKeymap: false }}
              placeholder="Escreva em Markdown…"
              autoFocus={!draft.body}
            />
          </div>
        )}
        {mode !== "edit" && (
          <article ref={previewRef} className="editor-pane markdown-preview" aria-label="Prévia">
            {draft.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: PreviewLink }}>{draft.body}</ReactMarkdown> : <p className="muted-small">Nada para mostrar ainda.</p>}
          </article>
        )}
      </div>

      <div className="editor-footer muted-small">
        <span>{countFormat.format(words)} {words === 1 ? "palavra" : "palavras"} · {countFormat.format(draft.body.length)} / {countFormat.format(MAX_BODY)} caracteres</span>
        <span>Ctrl+S salva · versão {note.version}</span>
      </div>
    </div>
  );
}

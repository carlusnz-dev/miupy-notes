import { useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type Ref } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { Bold, FileCode, Heading, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Quote, SquareCode, Strikethrough, Code } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { insertCodeBlock, insertLink, taskMarkerOnLine, taskToggleChange, toggleBlock, wrapSelection, type EditorTarget } from "../lib/notes-markdown";
import { animateIn } from "../lib/notes-motion";
import { liveMarkdown } from "./live-markdown";
import "./live-editor.css";

type Props = {
  /** Texto na montagem. O editor não é controlado: para trocar o texto por fora, remonte com outra `key`. */
  defaultValue: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Mostra o Markdown cru, sem renderização. */
  source: boolean;
  onSourceChange: (source: boolean) => void;
  autoFocus?: boolean;
  ref?: Ref<LiveMarkdownEditorHandle>;
};

export type LiveMarkdownEditorHandle = { focus: () => void };

const tools: Array<{ label: string; hint: string; icon: typeof Bold; run: (target: EditorTarget) => void }> = [
  { label: "Negrito", hint: "Ctrl+B", icon: Bold, run: (target) => wrapSelection(target, "**", "**", "texto") },
  { label: "Itálico", hint: "Ctrl+I", icon: Italic, run: (target) => wrapSelection(target, "_", "_", "texto") },
  { label: "Riscado", hint: "", icon: Strikethrough, run: (target) => wrapSelection(target, "~~", "~~", "texto") },
  { label: "Título", hint: "", icon: Heading, run: (target) => toggleBlock(target, "heading") },
  { label: "Lista", hint: "", icon: List, run: (target) => toggleBlock(target, "bullet") },
  { label: "Lista numerada", hint: "", icon: ListOrdered, run: (target) => toggleBlock(target, "ordered") },
  { label: "Tarefa", hint: "Ctrl+Enter alterna", icon: ListChecks, run: (target) => toggleBlock(target, "task") },
  { label: "Citação", hint: "", icon: Quote, run: (target) => toggleBlock(target, "quote") },
  { label: "Código", hint: "", icon: Code, run: (target) => wrapSelection(target, "`", "`", "código") },
  { label: "Bloco de código", hint: "", icon: SquareCode, run: insertCodeBlock },
  { label: "Link", hint: "Ctrl+K", icon: LinkIcon, run: insertLink },
];

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--color-background)", color: "var(--color-text)", fontSize: "var(--editor-size)", height: "100%" },
  ".cm-content": { fontFamily: "var(--editor-font)", lineHeight: "1.7", caretColor: "var(--color-text)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--color-border-strong)" },
}, { dark: true });

/** Links abrem no navegador do sistema; nunca navegam a janela do app. */
function openExternal(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  if (isTauri()) void openUrl(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

export default function LiveMarkdownEditor({ defaultValue, onChange, onSave, source, onSourceChange, autoFocus, ref }: Props) {
  // Fixo desde a montagem: um `value` novo faria o CodeMirror trocar o documento inteiro, inclusive por um texto mais velho.
  const [initialValue] = useState(defaultValue);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.view?.focus() }), []);
  // O atalho de salvar vive num ref para a lista de extensões não mudar a cada rascunho.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => animateIn(toolbarRef.current, { opacity: 0, y: -8 }, { duration: .24 }), []);

  const extensions = useMemo(() => [
    markdown({ base: markdownLanguage }),
    ...(source ? [] : [liveMarkdown({ openLink: openExternal })]),
    EditorView.scrollMargins.of(() => ({ top: 64, bottom: 120 })),
    EditorView.lineWrapping,
    editorTheme,
    EditorView.contentAttributes.of({ "aria-label": source ? "Markdown da nota (código-fonte)" : "Texto da nota", "aria-multiline": "true" }),
    // Prec.high: o mapa padrão do CodeMirror já usa Ctrl+Enter (linha em branco) e venceria o nosso.
    Prec.high(keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => { saveRef.current(); return true; } },
      { key: "Mod-b", run: (view) => { wrapSelection(view, "**", "**", "texto"); return true; } },
      { key: "Mod-i", run: (view) => { wrapSelection(view, "_", "_", "texto"); return true; } },
      { key: "Mod-k", preventDefault: true, run: (view) => { insertLink(view); return true; } },
      {
        key: "Mod-Enter",
        run: (view) => {
          const marker = taskMarkerOnLine(view.state, view.state.selection.main.head);
          const change = marker === null ? null : taskToggleChange(view.state, marker);
          if (change) view.dispatch({ changes: change });
          return change !== null;
        },
      },
    ])),
  ], [source]);

  function run(tool: (typeof tools)[number]) {
    const view = editorRef.current?.view;
    if (!view) return;
    tool.run(view);
    view.focus();
  }

  // Manter o foco no texto: o clique no botão não deve tirar a seleção do editor.
  const keepSelection = (event: MouseEvent) => event.preventDefault();

  return (
    <div className={`live-editor${source ? " live-editor-source" : ""}`}>
      <div className="live-toolbar" ref={toolbarRef} role="toolbar" aria-label="Formatação Markdown">
        {tools.map((tool) => (
          <button key={tool.label} type="button" className="tool-button" onMouseDown={keepSelection} onClick={() => run(tool)} title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label} aria-label={tool.label}>
            <tool.icon size={17} aria-hidden="true" />
          </button>
        ))}
        <span className="live-toolbar-divider" aria-hidden="true" />
        <button type="button" className="tool-button" onMouseDown={keepSelection} onClick={() => onSourceChange(!source)} aria-pressed={source} title={source ? "Voltar ao texto formatado" : "Ver código Markdown"} aria-label="Ver código Markdown">
          <FileCode size={17} aria-hidden="true" />
        </button>
      </div>
      <CodeMirror
        ref={editorRef}
        value={initialValue}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        basicSetup={{ syntaxHighlighting: false, lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, searchKeymap: false, foldKeymap: false }}
        placeholder="Escreva em Markdown…"
        autoFocus={autoFocus}
      />
    </div>
  );
}

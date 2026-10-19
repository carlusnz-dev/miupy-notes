import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { taskToggleChange } from "../lib/notes-markdown";

// Live Preview: o documento continua sendo o Markdown cru. Estas decorações só escondem marcadores e aplicam
// estilo; nunca alteram o texto. Os marcadores de um trecho voltam quando a seleção toca o trecho (inline) ou a
// linha (blocos), como no Live Preview do Obsidian.

const HIDE = Decoration.replace({});
const mark = (className: string, attributes?: Record<string, string>) => Decoration.mark({ class: className, attributes });
const lineClass = (className: string) => Decoration.line({ class: className });

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-hr";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked; }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-lp-checkbox";
    input.tabIndex = -1; // o teclado alterna com Ctrl+Enter, que edita o texto
    input.setAttribute("aria-label", this.checked ? "Tarefa concluída" : "Tarefa pendente");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      const change = taskToggleChange(view.state, view.posAtDOM(input));
      if (change) view.dispatch({ changes: change });
    });
    return input;
  }
  ignoreEvent() { return true; }
}

/** Só http(s): `data:`, `file:` e `javascript:` nunca viram imagem. */
const SAFE_IMAGE = /^https?:\/\/\S+$/i;

class ImageWidget extends WidgetType {
  constructor(private readonly alt: string, private readonly url: string) { super(); }
  eq(other: ImageWidget) { return other.url === this.url && other.alt === this.alt; }
  toDOM(view: EditorView) {
    // O elemento raiz do widget nunca é trocado: o CodeMirror leria a troca como edição do texto da nota.
    // Só o conteúdo interno muda (imagem → aviso de falha).
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-imgwrap";
    const img = document.createElement("img");
    img.className = "cm-lp-img";
    img.src = this.url;
    img.alt = this.alt;
    img.title = this.url;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer"; // não revela de qual nota/app veio o pedido
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => {
      wrap.textContent = `[imagem não carregada${this.alt ? `: ${this.alt}` : ""}]`;
      wrap.classList.add("cm-lp-image");
      view.requestMeasure();
    });
    wrap.appendChild(img);
    // Clicar na imagem revela o Markdown dela para editar ou apagar.
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }
}

const HEADING = /^ATXHeading([1-6])$/;
const BARE_URL_PARENTS = new Set(["Link", "Image", "LinkReference", "Autolink"]);

/** Decorações do Live Preview para os trechos `ranges` (a janela visível, ou o documento todo nos testes). */
export function buildLivePreview(state: EditorState, ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { doc } = state;
  const selection = state.selection.ranges;
  const touches = (from: number, to: number) => selection.some((range) => range.from <= to && range.to >= from);
  const lineTouches = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
  const hide = (from: number, to: number) => { if (to > from) out.push(HIDE.range(from, to)); };
  const hideWithSpace = (from: number, to: number) => hide(from, doc.sliceString(to, to + 1) === " " ? to + 1 : to);
  const linesOf = (from: number, to: number, className: string) => {
    for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
      out.push(lineClass(className).range(line.from));
      if (line.to >= to) break;
    }
  };
  const href = (node: { from: number; to: number }) => doc.sliceString(node.from, node.to).replace(/^<|>$/g, "");

  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const { name } = ref;
        const heading = HEADING.exec(name);
        if (heading) {
          out.push(lineClass(`cm-lp-h cm-lp-h${heading[1]}`).range(doc.lineAt(ref.from).from));
        } else if (name === "SetextHeading1" || name === "SetextHeading2") {
          out.push(lineClass(`cm-lp-h cm-lp-h${name.slice(-1)}`).range(doc.lineAt(ref.from).from));
        } else if (name === "HeaderMark") {
          const parent = ref.node.parent;
          if (parent && HEADING.test(parent.name) && !touches(parent.from, parent.to)) {
            if (ref.to < parent.to) hideWithSpace(ref.from, ref.to);
            else hide(doc.sliceString(ref.from - 1, ref.from) === " " ? ref.from - 1 : ref.from, ref.to);
          }
        } else if (name === "StrongEmphasis") out.push(mark("cm-lp-strong").range(ref.from, ref.to));
        else if (name === "Emphasis") out.push(mark("cm-lp-em").range(ref.from, ref.to));
        else if (name === "Strikethrough") out.push(mark("cm-lp-strike").range(ref.from, ref.to));
        else if (name === "InlineCode") out.push(mark("cm-lp-code").range(ref.from, ref.to));
        else if (name === "EmphasisMark" || name === "StrikethroughMark" || (name === "CodeMark" && ref.node.parent?.name === "InlineCode")) {
          const parent = ref.node.parent;
          if (parent && !touches(parent.from, parent.to)) hide(ref.from, ref.to);
        } else if (name === "Link" || name === "Autolink") {
          const marks = ref.node.getChildren("LinkMark");
          const url = ref.node.getChild("URL");
          if (marks.length >= 2 && url) {
            out.push(mark("cm-lp-link", { "data-href": href(url) }).range(marks[0].to, marks[1].from));
            if (!touches(ref.from, ref.to)) {
              hide(marks[0].from, marks[0].to);
              // Tudo depois do texto (`](url "título")`) ou o `>` do autolink.
              hide(marks[1].from, ref.to);
            }
          }
        } else if (name === "URL" && ref.node.parent && !BARE_URL_PARENTS.has(ref.node.parent.name)) {
          out.push(mark("cm-lp-link", { "data-href": href(ref) }).range(ref.from, ref.to));
        } else if (name === "Image") {
          const marks = ref.node.getChildren("LinkMark");
          const url = ref.node.getChild("URL");
          const target = url ? href(url) : "";
          if (marks.length >= 2 && SAFE_IMAGE.test(target) && !touches(ref.from, ref.to)) {
            out.push(Decoration.replace({ widget: new ImageWidget(doc.sliceString(marks[0].to, marks[1].from), target) }).range(ref.from, ref.to));
          } else out.push(mark("cm-lp-image").range(ref.from, ref.to));
          return false;
        }
        else if (name === "Blockquote") {
          linesOf(ref.from, ref.to, "cm-lp-quote");
        } else if (name === "QuoteMark") {
          if (!lineTouches(ref.from, ref.to)) hideWithSpace(ref.from, ref.to);
        } else if (name === "ListMark") {
          const item = ref.node.parent;
          const bullet = item?.parent?.name === "BulletList";
          if (!bullet) out.push(mark("cm-lp-listmark").range(ref.from, ref.to));
          else if (!lineTouches(ref.from, ref.to)) {
            if (item?.getChild("Task")) hideWithSpace(ref.from, ref.to);
            else out.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to));
          }
        } else if (name === "TaskMarker") {
          const checked = doc.sliceString(ref.from + 1, ref.to - 1).toLowerCase() === "x";
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(ref.from, ref.to));
          const task = ref.node.parent;
          if (checked && task && task.to > ref.to) out.push(mark("cm-lp-done").range(ref.to, task.to));
        } else if (name === "HorizontalRule") {
          if (lineTouches(ref.from, ref.to)) out.push(mark("cm-lp-rule-raw").range(ref.from, ref.to));
          else out.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
        } else if (name === "FencedCode" || name === "CodeBlock") {
          linesOf(ref.from, ref.to, "cm-lp-codeblock");
          if (name === "FencedCode") {
            out.push(lineClass("cm-lp-fence").range(doc.lineAt(ref.from).from));
            if (doc.lineAt(ref.to).number > doc.lineAt(ref.from).number) out.push(lineClass("cm-lp-fence").range(doc.lineAt(ref.to).from));
          }
          return false;
        } else if (name === "TableHeader") out.push(lineClass("cm-lp-table-head").range(doc.lineAt(ref.from).from));
        else if (name === "TableRow") out.push(lineClass("cm-lp-table-row").range(doc.lineAt(ref.from).from));
        else if (name === "TableDelimiter") out.push(mark("cm-lp-table-delim").range(ref.from, ref.to));
        return undefined;
      },
    });
  }
  return Decoration.set(out, true);
}

// --- Tabelas: widget de bloco no lugar do texto, enquanto a seleção não toca a tabela. ---

type TableCell = { text: string; from: number };

/** Divide uma linha de tabela em células com o deslocamento de cada uma (para o clique cair na célula certa). */
export function splitTableRow(line: string): TableCell[] {
  const cells: TableCell[] = [];
  const pipe = /(?<!\\)\|/g;
  let start = 0;
  const push = (end: number) => {
    const raw = line.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    cells.push({ text: raw.trim().replace(/\\\|/g, "|"), from: start + lead });
  };
  for (const match of line.matchAll(pipe)) {
    if (match.index > 0 || line.slice(0, match.index).trim()) push(match.index);
    start = match.index + 1;
  }
  if (line.slice(start).trim()) push(line.length);
  return cells;
}

const ALIGN = (spec: string) => (/^:-+:$/.test(spec) ? "center" : /-:$/.test(spec) ? "right" : /^:-/.test(spec) ? "left" : "");

/** Markdown inline mínimo para células: código, negrito, itálico, riscado e links (texto apenas). Sem HTML. */
function renderInline(text: string, into: Node) {
  const token = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|_[^_]+_|\*[^*]+\*|\[[^\]]+\]\([^)]*\))/g;
  let last = 0;
  for (const match of text.matchAll(token)) {
    if (match.index > last) into.appendChild(document.createTextNode(text.slice(last, match.index)));
    const part = match[0];
    const wrap = (tag: string, inner: string, className?: string) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      renderInline(inner, element);
      into.appendChild(element);
    };
    if (part.startsWith("`")) { const code = document.createElement("code"); code.textContent = part.slice(1, -1); into.appendChild(code); }
    else if (part.startsWith("**")) wrap("strong", part.slice(2, -2));
    else if (part.startsWith("~~")) wrap("s", part.slice(2, -2));
    else if (part.startsWith("[")) wrap("span", part.slice(1, part.indexOf("]")), "cm-lp-link");
    else wrap("em", part.slice(1, -1));
    last = match.index + part.length;
  }
  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}

class TableWidget extends WidgetType {
  constructor(private readonly lines: string[]) { super(); }
  eq(other: TableWidget) { return other.lines.join("\n") === this.lines.join("\n"); }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    const aligns = splitTableRow(this.lines[1] ?? "").map((cell) => ALIGN(cell.text));
    const lineOffsets: number[] = [];
    this.lines.reduce((offset, line) => { lineOffsets.push(offset); return offset + line.length + 1; }, 0);
    this.lines.forEach((line, row) => {
      if (row === 1) return; // linha de alinhamento (|---|---|)
      const tr = document.createElement("tr");
      splitTableRow(line).forEach((cell, column) => {
        const td = document.createElement(row === 0 ? "th" : "td");
        if (aligns[column]) td.style.textAlign = aligns[column];
        renderInline(cell.text, td);
        td.dataset.offset = String(lineOffsets[row] + cell.from);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    // Clicar revela o Markdown da tabela com o cursor na célula clicada.
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const cell = (event.target as Element).closest<HTMLElement>("[data-offset]");
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) + Number(cell?.dataset.offset ?? 0) }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() { return true; }
}

export function buildTableBlocks(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { doc } = state;
  const tree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return undefined;
      const touched = state.selection.ranges.some((range) => range.from <= ref.to && range.to >= ref.from);
      // Tabelas dentro de citação/lista (linhas com prefixo) ficam como texto: dividir por `|` perderia o prefixo.
      if (!touched && doc.lineAt(ref.from).from === ref.from) {
        const lines = doc.sliceString(ref.from, ref.to).split("\n");
        if (lines.length >= 2) out.push(Decoration.replace({ widget: new TableWidget(lines), block: true }).range(ref.from, ref.to));
      }
      return false;
    },
  });
  return Decoration.set(out, true);
}

const tableField = StateField.define<DecorationSet>({
  create: buildTableBlocks,
  update(value, tr) {
    return tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildTableBlocks(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = buildLivePreview(view.state, view.visibleRanges); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = buildLivePreview(update.state, update.view.visibleRanges);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

/** Ctrl/Cmd+clique num link abre fora do editor; o clique simples só posiciona o cursor para editar. */
function linkOpener(open: (href: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return false;
      const href = event.target.closest("[data-href]")?.getAttribute("data-href");
      if (!href) return false;
      event.preventDefault();
      open(href);
      return true;
    },
  });
}

export function liveMarkdown(options: { openLink: (href: string) => void }): Extension {
  return [livePreviewPlugin, tableField, linkOpener(options.openLink)];
}

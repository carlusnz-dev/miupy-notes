import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

// O CodeMirror divide linhas em \n, \r\n e \r e junta de volta com \n. Para não trocar o fim de linha de uma
// nota só por abri-la, o editor trabalha com \n e a gravação restaura o estilo dominante do original.
export type Eol = "\n" | "\r\n" | "\r";

export function detectEol(text: string): Eol {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const cr = text.match(/\r(?!\n)/g)?.length ?? 0;
  const lf = text.match(/(?<!\r)\n/g)?.length ?? 0;
  if (crlf > lf && crlf >= cr) return "\r\n";
  if (cr > lf && cr > crlf) return "\r";
  return "\n";
}

export function toEditorText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function fromEditorText(text: string, eol: Eol): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

/** Alvo mínimo dos comandos: `EditorView` serve, e o estado puro permite testar sem DOM. */
export type EditorTarget = { readonly state: EditorState; dispatch(spec: TransactionSpec): void };

/** Envolve a seleção; repetir o comando desfaz (marcadores dentro ou ao redor da seleção). */
export function wrapSelection(target: EditorTarget, before: string, after = before, placeholder = ""): void {
  const { state } = target;
  target.dispatch(state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const around = state.sliceDoc(Math.max(0, range.from - before.length), range.from) === before
      && state.sliceDoc(range.to, range.to + after.length) === after
      && range.from >= before.length;
    if (around && (text !== "" || placeholder === "")) {
      return {
        changes: [{ from: range.from - before.length, to: range.from }, { from: range.to, to: range.to + after.length }],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      };
    }
    if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
      const inner = text.slice(before.length, text.length - after.length);
      return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) };
    }
    const content = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: `${before}${content}${after}` },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + content.length),
    };
  }));
}

export type BlockKind = "heading" | "bullet" | "ordered" | "task" | "quote";

// Cada tipo reconhece só o próprio prefixo; `BLOCK_PREFIX` reconhece qualquer um para trocá-lo.
const KIND_PREFIX: Record<BlockKind, RegExp> = {
  heading: /^(\s*)## /,
  bullet: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  ordered: /^(\s*)\d+[.)] /,
  task: /^(\s*)[-*+] \[[ xX]\] /,
  quote: /^(\s*)> ?/,
};
const BLOCK_PREFIX = /^(\s*)(?:#{1,6} +|[-*+] +\[[ xX]\] +|[-*+] +|\d+[.)] +|>+ ?)/;

/** Alterna título, lista, tarefa ou citação nas linhas da seleção, trocando outro prefixo de bloco se houver. */
export function toggleBlock(target: EditorTarget, kind: BlockKind): void {
  const { state } = target;
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let line = state.doc.lineAt(range.from).number; line <= state.doc.lineAt(range.to).number; line++) numbers.add(line);
  }
  const lines = [...numbers].sort((a, b) => a - b).map((number) => state.doc.line(number));
  const remove = lines.every((line) => KIND_PREFIX[kind].test(line.text));
  target.dispatch({
    changes: lines.map((line, index) => {
      const existing = BLOCK_PREFIX.exec(line.text);
      const indent = existing?.[1] ?? /^\s*/.exec(line.text)![0];
      const replaceTo = line.from + (existing ? existing[0].length : indent.length);
      const prefix = remove ? "" : { heading: "## ", bullet: "- ", ordered: `${index + 1}. `, task: "- [ ] ", quote: "> " }[kind];
      return { from: line.from + indent.length, to: replaceTo, insert: prefix };
    }),
  });
}

/** Troca `[ ]` por `[x]` (e o inverso) quando `pos` é o início de um marcador de tarefa. */
export function taskToggleChange(state: EditorState, pos: number): { from: number; to: number; insert: string } | null {
  const marker = state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return null;
  return { from: pos + 1, to: pos + 2, insert: marker[1] === " " ? "x" : " " };
}

/** Marcador de tarefa da linha do cursor, para o atalho de teclado. */
export function taskMarkerOnLine(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos);
  const match = /^(\s*(?:>\s*)*[-*+]\s+)\[[ xX]\]/.exec(line.text);
  return match ? line.from + match[1].length : null;
}

export const insertLink = (target: EditorTarget) => wrapSelection(target, "[", "](https://)", "texto");
export const insertCodeBlock = (target: EditorTarget) => wrapSelection(target, "```\n", "\n```", "código");

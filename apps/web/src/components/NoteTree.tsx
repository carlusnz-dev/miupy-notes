import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import gsap from "gsap";
import { ChevronRight, FilePlus, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Pencil } from "lucide-react";
import type { NoteMetadataOutput } from "../lib/notes-api";
import { MAX_FOLDER_NAME, type FolderOutput } from "../lib/notes-folders-api";
import { reducedMotion } from "../lib/notes-motion";
import { folderChoices, type NotesTree, type TreeFolder } from "../lib/notes-tree";
import Badge from "./Badge";
import "./note-tree.css";

type Action<T extends unknown[]> = (...args: T) => Promise<void> | void;

type NoteTreeProps = {
  tree: NotesTree;
  /** ID de uma pasta recém-criada: entra em modo de renomear, já com o nome selecionado. */
  renameRequest?: string | null;
  disabled?: boolean;
  onOpenNote: Action<[NoteMetadataOutput]>;
  onCreateNote: Action<[folderId: string | null]>;
  onCreateFolder: Action<[parentId: string | null]>;
  onRenameFolder: Action<[FolderOutput, name: string]>;
  onMoveNote: Action<[NoteMetadataOutput, folderId: string | null]>;
};

const COLLAPSED_KEY = "miupy.notes-tree.collapsed.v1";
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

// Preferência só deste aparelho: sem armazenamento disponível, as pastas começam abertas.
function readCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Abre e fecha o conteúdo de uma pasta; sem movimento reduzido, anima a altura com GSAP. */
function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (previous.current === null) {
      element.hidden = !open;
      previous.current = open;
      return;
    }
    if (previous.current === open) return;
    previous.current = open;
    gsap.killTweensOf(element);
    if (reducedMotion()) {
      element.hidden = !open;
      gsap.set(element, { clearProps: "height,opacity,overflow" });
      return;
    }
    if (open) {
      element.hidden = false;
      gsap.fromTo(element, { height: 0, opacity: 0, overflow: "hidden" }, { height: "auto", opacity: 1, duration: .22, ease: "power2.out", clearProps: "height,opacity,overflow" });
    } else {
      gsap.to(element, { height: 0, opacity: 0, overflow: "hidden", duration: .16, ease: "power2.in", onComplete: () => { element.hidden = true; gsap.set(element, { clearProps: "height,opacity,overflow" }); } });
    }
  }, [open]);
  return <div ref={ref} id={id} className="tree-collapse">{children}</div>;
}

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    const name = ref.current?.value.trim() ?? "";
    if (commit && name && name !== initial) onCommit(name);
    else onCancel();
  }
  return (
    <input
      ref={ref}
      className="tree-rename"
      aria-label="Nome da pasta"
      defaultValue={initial}
      maxLength={MAX_FOLDER_NAME}
      autoComplete="off"
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); finish(true); }
        else if (event.key === "Escape") { event.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}

export default function NoteTree({ tree, renameRequest = null, disabled = false, onOpenNote, onCreateNote, onCreateFolder, onRenameFolder, onMoveNote }: NoteTreeProps) {
  const baseId = useId();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  // ID da nota em arrasto. Pastas não se movem nesta etapa (ver docs/arquitetura/api.md).
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => { if (renameRequest) setRenaming(renameRequest); }, [renameRequest]);

  function toggle(id: string, open?: boolean) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open ?? next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* A preferência vale só nesta sessão. */ }
      return next;
    });
  }

  const reveal = (id: string | null) => { if (id && collapsed.has(id)) toggle(id, true); };
  const idOf = (key: string) => `${baseId}-${key}`;

  function dropProps(target: string | null) {
    const key = target ?? "root";
    return {
      onDragOver: (event: DragEvent) => {
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      },
      onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => (current === key ? null : current)); },
      onDrop: (event: DragEvent) => {
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        const note = findNote(dragging);
        setDragging(null);
        setDropTarget(null);
        reveal(target);
        if (note) void onMoveNote(note, target);
      },
    };
  }

  function findNote(id: string): NoteMetadataOutput | undefined {
    const walk = (notes: NoteMetadataOutput[], folders: TreeFolder[]): NoteMetadataOutput | undefined =>
      notes.find((note) => note.id === id) ?? folders.reduce<NoteMetadataOutput | undefined>((found, node) => found ?? walk(node.notes, node.folders), undefined);
    return walk(tree.notes, tree.folders);
  }
  // Função (não componente): definida por render, um componente remontaria o <select> e perderia o foco.
  function moveSelect({ label, current, onPick }: { label: string; current: string | null; onPick: (folderId: string | null) => void }) {
    return (
      <select
        className="tree-move"
        aria-label={`Mover ${label} para`}
        autoFocus
        value={current ?? ""}
        onChange={(event) => { setMoving(null); onPick(event.target.value || null); }}
        onBlur={() => setMoving(null)}
        onKeyDown={(event) => { if (event.key === "Escape") setMoving(null); }}
      >
        <option value="">Raiz</option>
        {folderChoices(tree).map((choice) => <option key={choice.id} value={choice.id}>{"  ".repeat(choice.depth)}{choice.name}</option>)}
      </select>
    );
  }

  function iconButton(label: string, icon: ReactNode, onClick: () => void) {
    return <button type="button" className="tool-button tree-action" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{icon}</button>;
  }

  function renderNote(note: NoteMetadataOutput) {
    const key = `note:${note.id}`;
    return (
      <li key={note.id} className={`tree-row tree-note${dragging === note.id ? " is-dragging" : ""}`} draggable={!disabled && moving !== key} onDragStart={(event) => { event.dataTransfer.setData("text/plain", note.id); event.dataTransfer.effectAllowed = "move"; setDragging(note.id); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }}>
        <button type="button" className="tree-main" onClick={() => void onOpenNote(note)}>
          <FileText size={16} aria-hidden="true" />
          <strong>{note.title}</strong>
        </button>
        <span className="tree-meta">
          {note.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}
          {note.tags.length > 3 && <span className="muted-small">+{note.tags.length - 3}</span>}
          <time dateTime={note.updatedAt}>{dateFormat.format(new Date(note.updatedAt))}</time>
        </span>
        <span className="tree-actions">
          {moving === key
            ? moveSelect({ label: `a nota ${note.title}`, current: note.folderId ?? null, onPick: (folderId) => { reveal(folderId); void onMoveNote(note, folderId); } })
            : iconButton(`Mover a nota ${note.title}`, <FolderInput size={15} aria-hidden="true" />, () => setMoving(key))}
        </span>
      </li>
    );
  }

  function renderFolder(node: TreeFolder) {
    const { folder } = node;
    const open = !collapsed.has(folder.id);
    const contentId = idOf(folder.id);
    const empty = node.folders.length === 0 && node.notes.length === 0;
    return (
      <li key={folder.id} className="tree-folder">
        <div className={`tree-row${dropTarget === folder.id ? " is-drop-target" : ""}`} {...dropProps(folder.id)}>
          {renaming === folder.id ? (
            <span className="tree-main">
              <Folder size={16} aria-hidden="true" />
              <RenameInput initial={folder.name} onCancel={() => setRenaming(null)} onCommit={(name) => { setRenaming(null); void onRenameFolder(folder, name); }} />
            </span>
          ) : (
            <button type="button" className="tree-main" aria-expanded={open} aria-controls={contentId} onClick={() => toggle(folder.id)}>
              <ChevronRight size={14} className={`tree-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
              {open ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
              <strong>{folder.name}</strong>
              <span className="tree-count" aria-label={`${node.noteCount} ${node.noteCount === 1 ? "nota" : "notas"}`}>{node.noteCount}</span>
            </button>
          )}
          <span className="tree-actions">
            {iconButton(`Nova nota em ${folder.name}`, <FilePlus size={15} aria-hidden="true" />, () => { reveal(folder.id); void onCreateNote(folder.id); })}
            {iconButton(`Nova pasta em ${folder.name}`, <FolderPlus size={15} aria-hidden="true" />, () => { reveal(folder.id); void onCreateFolder(folder.id); })}
            {iconButton(`Renomear ${folder.name}`, <Pencil size={15} aria-hidden="true" />, () => setRenaming(folder.id))}
          </span>
        </div>
        <Collapse open={open} id={contentId}>
          <ul className="tree-list">
            {node.folders.map(renderFolder)}
            {node.notes.map(renderNote)}
            {empty && <li className="tree-empty muted-small">Pasta vazia</li>}
          </ul>
        </Collapse>
      </li>
    );
  }

  return (
    <div className={`note-tree${dropTarget === "root" ? " is-drop-target" : ""}`} {...dropProps(null)}>
      <ul className="tree-list tree-root" aria-label="Pastas e notas">
        {tree.folders.map(renderFolder)}
        {tree.notes.map(renderNote)}
      </ul>
      {dragging && <p className="tree-drop-hint muted-small" aria-hidden="true">Solte fora das pastas para mover para a raiz.</p>}
    </div>
  );
}

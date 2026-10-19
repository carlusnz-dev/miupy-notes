import type { FolderOutput } from "./notes-folders-api";
import type { NoteOutput } from "./notes-api";

export type TreeFolder = { folder: FolderOutput; folders: TreeFolder[]; notes: NoteOutput[]; noteCount: number };
export type NotesTree = { folders: TreeFolder[]; notes: NoteOutput[] };

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Monta a árvore a partir das listas planas. Notas e pastas cujo pai não existe (ou que formam ciclo) vão
 * para a raiz: nunca somem da tela, mesmo que a API devolva um estado inconsistente.
 */
export function buildNotesTree(folders: readonly FolderOutput[], notes: readonly NoteOutput[]): NotesTree {
  const nodes = new Map<string, TreeFolder>(folders.map((folder) => [folder.id, { folder, folders: [], notes: [], noteCount: 0 }]));
  const reachable = (id: string) => {
    for (let cursor: string | null = id, steps = 0; cursor !== null && steps <= nodes.size; steps++) {
      const parent: string | null = nodes.get(cursor)?.folder.parentId ?? null;
      if (parent === null || !nodes.has(parent)) return true;
      if (parent === id) return false;
      cursor = parent;
    }
    return false;
  };

  const root: NotesTree = { folders: [], notes: [] };
  for (const node of nodes.values()) {
    const parent = node.folder.parentId !== null && reachable(node.folder.id) ? nodes.get(node.folder.parentId) : undefined;
    (parent ? parent.folders : root.folders).push(node);
  }
  for (const note of notes) {
    const folder = note.folderId ? nodes.get(note.folderId) : undefined;
    (folder ? folder.notes : root.notes).push(note);
  }

  const sortNotes = (items: NoteOutput[]) => items.sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
  const finish = (items: TreeFolder[]) => {
    items.sort((a, b) => collator.compare(a.folder.name, b.folder.name) || a.folder.id.localeCompare(b.folder.id));
    for (const node of items) {
      finish(node.folders);
      sortNotes(node.notes);
      node.noteCount = node.notes.length + node.folders.reduce((total, child) => total + child.noteCount, 0);
    }
  };
  finish(root.folders);
  sortNotes(root.notes);
  return root;
}

export type FolderChoice = { id: string; name: string; label: string; depth: number };

/** Pastas em ordem de árvore, para o seletor "Mover para…". */
export function folderChoices(tree: NotesTree): FolderChoice[] {
  const out: FolderChoice[] = [];
  const walk = (items: TreeFolder[], depth: number, path: string) => {
    for (const node of items) {
      const label = path ? `${path} / ${node.folder.name}` : node.folder.name;
      out.push({ id: node.folder.id, name: node.folder.name, label, depth });
      walk(node.folders, depth + 1, label);
    }
  };
  walk(tree.folders, 0, "");
  return out;
}

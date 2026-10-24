import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FilePlus, FolderPlus } from "lucide-react";
import NoteTree from "./components/NoteTree";
import { SkeletonBody } from "./components/Skeleton";
import { ApiError } from "./lib/api-client";
import SignOutButton from "./components/SignOutButton";
import { signIn, useAuth } from "./lib/auth";
import { animateIn } from "./lib/notes-motion";
import { buildNotesTree } from "./lib/notes-tree";
import { usePreviewWorkspace, useRemoteWorkspace, type PreviewWorkspaceState, type Workspace } from "./lib/notes-workspace";
import { usePageTitle } from "./lib/use-page-title";
import "./notes.css";
import Button from "./components/Button";
import PageHeader from "./components/PageHeader";

const PREVIEW_STATES: Record<string, PreviewWorkspaceState | "deslogado"> = { carregando: "carregando", vazio: "vazio", erro: "erro", arvore: "arvore", lista: "arvore", deslogado: "deslogado" };

function errorMessage(error: ApiError): string {
  return error.code === "FORBIDDEN" ? "Esta conta não tem acesso a esta API." : error.message;
}

function RequestId({ error }: { error: ApiError }) {
  return error.requestId ? <p className="muted-small">Código do pedido: <code>{error.requestId}</code></p> : null;
}

function StatePanel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="state-panel"><strong>{title}</strong>{children}</div>;
}

function SignedInNotes({ workspace, preview }: { workspace: Workspace; preview: boolean }) {
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tree = useMemo(() => buildNotesTree(workspace.folders, workspace.notes), [workspace.folders, workspace.notes]);
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => (workspace.status === "ready" ? animateIn(treeRef.current, { opacity: 0, y: 8 }, { duration: .22 }) : undefined), [workspace.status]);

  // Uma operação por vez: evita criar duas notas num duplo clique e pedidos com `version` velha.
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      // 401 já derruba a sessão (query-client); o painel de login assume.
      if (error instanceof ApiError && error.code !== "UNAUTHORIZED") setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  const createNote = (folderId: string | null) => run(async () => {
    const note = await workspace.createNote(folderId);
    // O editor foca o título: a nota nasce como "Sem título" e o usuário digita o nome.
    navigate(`/notes/${note.id}${preview ? "?estado=novo" : ""}`, { state: { focusTitle: true } });
  });

  const createFolder = (parentId: string | null) => run(async () => {
    const folder = await workspace.createFolder(parentId);
    setRenameRequest(folder.id);
  });

  const count = workspace.notes.length;
  const countLabel = workspace.status === "ready"
    ? `${count} ${count === 1 ? "nota" : "notas"} · ${workspace.folders.length} ${workspace.folders.length === 1 ? "pasta" : "pastas"}`
    : "Suas notas";

  return (
    <>
      <div className="notes-toolbar">
        <div className="notes-toolbar-status">
          <span>{countLabel}</span>
          {workspace.status === "ready" && !preview && workspace.refreshing && <span className="refresh-status" role="status">Atualizando…</span>}
        </div>
        <SignOutButton disabled={preview} />
      </div>

      <div className="notes-actions" role="group" aria-label="Criar">
        <Button variant="primary" className="notes-new" type="button" onClick={() => void createNote(null)} disabled={busy || workspace.status !== "ready"}>
          <FilePlus size={16} aria-hidden="true" /> Nova nota
        </Button>
        <Button className="notes-new" type="button" onClick={() => void createFolder(null)} disabled={busy || workspace.status !== "ready"}>
          <FolderPlus size={16} aria-hidden="true" /> Nova pasta
        </Button>
      </div>

      {actionError && (
        <div className="form-error notes-error" role="alert">
          <p>{errorMessage(actionError)}</p>
          <RequestId error={actionError} />
        </div>
      )}

      <section aria-busy={workspace.status === "loading"}>
        {workspace.status === "loading" && <SkeletonBody label="Carregando notas…" cards={4} cardHeight={54} />}

        {workspace.status === "error" && workspace.error && (
          <StatePanel title="Não foi possível carregar as notas">
            <p>{errorMessage(workspace.error)}</p>
            <RequestId error={workspace.error} />
            <Button type="button" onClick={workspace.retry} disabled={preview}>Tentar de novo</Button>
          </StatePanel>
        )}

        {workspace.status === "ready" && workspace.notes.length === 0 && workspace.folders.length === 0 && (
          <StatePanel title="Nenhuma nota ainda">
            <p>Use “Nova nota” para começar: ela abre direto no editor, com o título selecionado.</p>
          </StatePanel>
        )}

        {workspace.status === "ready" && (workspace.notes.length > 0 || workspace.folders.length > 0) && (
          <div ref={treeRef}>
            <NoteTree
              tree={tree}
              renameRequest={renameRequest}
              disabled={busy}
              onOpenNote={(note) => navigate(`/notes/${note.id}${preview ? "?estado=editor" : ""}`)}
              onCreateNote={createNote}
              onCreateFolder={createFolder}
              onRenameFolder={(folder, name) => run(() => workspace.renameFolder(folder, name))}
              onMoveNote={(note, folderId) => run(() => workspace.moveNote(note, folderId))}
            />
            {workspace.truncated && <p className="muted-small notes-truncated">Há mais notas do que o limite carregado nesta tela; as mais antigas na ordem do servidor não aparecem aqui.</p>}
          </div>
        )}
      </section>
    </>
  );
}

function PreviewNotes({ state }: { state: PreviewWorkspaceState }) {
  return <SignedInNotes workspace={usePreviewWorkspace(state)} preview />;
}

function RemoteNotes() {
  return <SignedInNotes workspace={useRemoteWorkspace(true)} preview={false} />;
}

export default function NotesPage() {
  usePageTitle("Notas");
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV ? PREVIEW_STATES[searchParams.get("estado") ?? ""] ?? null : null;
  const auth = useAuth();
  const status = preview === "deslogado" ? "signed-out" : preview ? "signed-in" : auth.status;

  return (
    <div className="feature-page notes-page">
      <PageHeader eyebrow="ACERVO PESSOAL" title="Notas" description="Ideias, páginas e conexões em um lugar." />

      {status === "checking" && (
        <div className="notes-state">
          <SkeletonBody label="Verificando a conta…" lines={2} cards={1} cardHeight={120} />
        </div>
      )}

      {status === "unsupported" && (
        <div className="notes-state">
          <StatePanel title="Login só no app desktop">
            <p>Abra o miupy notes no app desktop para entrar com Google e ver suas notas. Neste navegador, a tela não conversa com a API.</p>
          </StatePanel>
        </div>
      )}

      {status === "signed-out" && (
        <div className="notes-state">
          <StatePanel title="Conta não conectada">
            <p>Entre com sua conta Google para ver e criar notas. O login abre o navegador do sistema.</p>
            {!preview && auth.error && <p className="form-error" role="alert">{auth.error}</p>}
            <Button variant="primary" type="button" onClick={() => { if (!preview) void signIn(); }} disabled={auth.signingIn || !!preview}>
              {auth.signingIn ? "Aguardando o navegador…" : "Entrar com Google"}
            </Button>
          </StatePanel>
        </div>
      )}

      {status === "signed-in" && (preview && preview !== "deslogado" ? <PreviewNotes state={preview} /> : <RemoteNotes />)}
    </div>
  );
}

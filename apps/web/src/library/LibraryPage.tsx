import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import ButtonGroup from "../components/ButtonGroup";
import ConfirmDialog from "../components/ConfirmDialog";
import Select from "../components/Select";
import { SkeletonBody } from "../components/Skeleton";
import { signIn, useAuth } from "../lib/auth";
import { deleteLibraryItem, getLibraryItem, listLibrary, type LibraryFilters, type LibraryItem } from "../lib/library-api";
import { usePageTitle } from "../lib/use-page-title";
import LibraryForm from "./LibraryForm";
import LibraryCard from "./LibraryCard";
import { kinds, statuses } from "./labels";
import "./library.css";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";

export default function LibraryPage() {
  usePageTitle("Biblioteca");
  const auth = useAuth();
  if (auth.status === "signed-in") return <LibraryWorkspace />;
  return <section className="library-page"><PageHeader eyebrow="ACERVO CULTURAL" title="Biblioteca" description="Livros, filmes e músicas que ficaram." />{auth.status === "checking" ? <p role="status">Verificando sua conta…</p> : auth.status === "unsupported" ? <p>Abra o aplicativo desktop para conectar sua conta e acessar sua biblioteca.</p> : <Button variant="primary" onClick={() => void signIn()} disabled={auth.signingIn}>{auth.signingIn ? "Conectando…" : "Entrar com Google"}</Button>}{auth.error && <p role="alert">{auth.error}</p>}</section>;
}

export function LibraryWorkspace() {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "all", status = params.get("status") ?? "", q = params.get("q") ?? "", tag = params.get("tag") ?? "";
  const cursor = params.get("cursor") ?? undefined;
  const [page, setPage] = useState<Awaited<ReturnType<typeof listLibrary>>>();
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{ existing?: LibraryItem } | null>(null);
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState(false), [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    listLibrary({ kind: kind === "all" ? undefined : kind as LibraryFilters["kind"], status: status ? status as LibraryFilters["status"] : undefined, q: q || undefined, tag: tag || undefined, cursor, signal: abort.signal })
      .then(data => { if (!abort.signal.aborted) setPage(data); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível carregar a biblioteca."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [kind, status, q, tag, cursor, revision]);
  function filter(values: Record<string, string>) {
    const next = new URLSearchParams(params); next.delete("cursor");
    Object.entries(values).forEach(([key, value]) => { if (value && value !== "all") next.set(key, value); else next.delete(key); }); setParams(next);
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    filter({ q: String(data.get("q") ?? "").trim(), tag: String(data.get("tag") ?? "").trim() });
  }
  function reload() { setRevision(value => value + 1); }
  async function edit(item: LibraryItem) {
    setBusy(true); setError("");
    try { setForm({ existing: await getLibraryItem(item.id) }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir a obra. Tente de novo."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return; setBusy(true); setDeleteError("");
    try { await deleteLibraryItem(deleting.id); setDeleting(null); reload(); }
    catch (e) { setDeleteError(e instanceof Error ? e.message : "Não foi possível excluir. Tente de novo."); }
    finally { setBusy(false); }
  }
  return <section className="library-page" aria-labelledby="library-title" aria-busy={busy}>
    <PageHeader className="library-heading" id="library-title" eyebrow="ACERVO CULTURAL" title="Biblioteca" description="Livros, filmes e músicas que ficaram." actions={<Button variant="primary" onClick={() => setForm({})} disabled={busy}>Adicionar obra</Button>} />
    <div className="library-toolbar"><ButtonGroup label="Tipo de obra" value={kind} options={[{ value: "all", label: "Tudo" }, ...kinds]} onChange={value => filter({ kind: value })} /><Select label="Filtrar por status" value={status} options={[{ value: "", label: "Todos os status" }, ...statuses]} onChange={value => filter({ status: value })} /></div>
    <form key={`${q}:${tag}`} className="library-search" onSubmit={search} role="search" autoComplete="off"><label>Buscar pelo título<input name="q" type="search" maxLength={200} defaultValue={q} placeholder="Uma obra que ficou…" /></label><label>Tag<input name="tag" maxLength={40} defaultValue={tag} placeholder="Ex.: favoritos…" /></label><Button type="submit">Buscar</Button>{(q || tag || status || kind !== "all") && <Button type="button" onClick={() => setParams({})}>Limpar filtros</Button>}</form>
    {error && <div className="library-error" role="alert">{error} <Button onClick={reload}>Tentar de novo</Button></div>}
    {loading ? <SkeletonBody label="Carregando biblioteca…" cards={4} columns={4} cardHeight={320} /> : !error ? <>
      <p className="library-result" role="status">{page?.items.length ?? 0} obra(s) nesta página</p>
      {page?.items.length ? <div className="library-grid">{page.items.map(item => <LibraryCard key={item.id} item={item} onEdit={() => { if (!busy) void edit(item); }} onDelete={() => { if (!busy) { setDeleteError(""); setDeleting(item); } }} />)}</div> : <div className="library-empty"><span aria-hidden="true">Aa</span><h2>{kind !== "all" || status || q || tag ? "Nenhuma obra por aqui" : "Sua próxima descoberta começa aqui"}</h2><p>{page?.nextCursor ? "Continue para a próxima página para ver mais resultados." : q || tag || kind !== "all" || status ? "Experimente outro título ou limpe os filtros." : "Guarde o que quer conhecer e o que merece ficar na memória."}</p><Button onClick={() => setForm({})}>Adicionar obra</Button></div>}
      <nav className="library-pagination" aria-label="Páginas da biblioteca"><Button disabled={!cursor} onClick={() => { const next = new URLSearchParams(params); next.delete("cursor"); setParams(next); }}>Primeira página</Button><Button disabled={!page?.nextCursor} onClick={() => { const next = new URLSearchParams(params); next.set("cursor", page!.nextCursor!); setParams(next); }}>Próxima página</Button></nav>
    </> : null}
    {form && <LibraryForm existing={form.existing} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    <ConfirmDialog open={!!deleting} title="Excluir obra?" confirmLabel="Excluir obra" busyLabel="Excluindo…" busy={busy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void remove()}><p>A obra “{deleting?.title}” será excluída. Esta ação não pode ser desfeita.</p></ConfirmDialog>
  </section>;
}

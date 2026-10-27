import { SlidersHorizontal, Plus } from "lucide-react";
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
import LibraryEmpty from "./LibraryEmpty";
import LibraryFilterSheet from "./LibraryFilterSheet";
import { kinds, statuses } from "./labels";
import { countLabel, useCompact } from "./view";
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
  const compact = useCompact();
  const [sheet, setSheet] = useState(false);
  const filtered = !!(q || tag || status || kind !== "all");
  const sheetCount = (status ? 1 : 0) + (tag ? 1 : 0);
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
    // No mobile a tag fica na folha de filtros: só troca o que o formulário traz.
    filter({ q: String(data.get("q") ?? "").trim(), ...(data.has("tag") && { tag: String(data.get("tag")).trim() }) });
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
    <PageHeader className="library-heading" id="library-title" eyebrow="ACERVO CULTURAL" title="Biblioteca" description="Livros, filmes e músicas que ficaram." actions={compact ? undefined : <Button variant="primary" onClick={() => setForm({})} disabled={busy}>Adicionar obra</Button>} />
    <div className="library-toolbar"><ButtonGroup label="Tipo de obra" value={kind} options={[{ value: "all", label: "Tudo" }, ...kinds]} onChange={value => filter({ kind: value })} />{!compact && <Select label="Filtrar por status" value={status} options={[{ value: "", label: "Todos os status" }, ...statuses]} onChange={value => filter({ status: value })} />}</div>
    {compact
      ? <form key={q} className="library-search" onSubmit={search} role="search" autoComplete="off"><label><span className="visually-hidden">Buscar pelo título</span><input name="q" type="search" enterKeyHint="search" maxLength={200} defaultValue={q} placeholder="Buscar pelo título…" /></label><Button size="lg" aria-haspopup="dialog" onClick={() => setSheet(true)}><SlidersHorizontal size={18} aria-hidden="true" />Filtros{sheetCount > 0 && <span aria-label={`, ${sheetCount} ativo${sheetCount > 1 ? "s" : ""}`}> ({sheetCount})</span>}</Button></form>
      : <form key={`${q}:${tag}`} className="library-search" onSubmit={search} role="search" autoComplete="off"><label>Buscar pelo título<input name="q" type="search" maxLength={200} defaultValue={q} placeholder="Uma obra que ficou…" /></label><label>Tag<input name="tag" maxLength={40} defaultValue={tag} placeholder="Ex.: favoritos…" /></label><Button type="submit">Buscar</Button>{filtered && <Button type="button" onClick={() => setParams({})}>Limpar filtros</Button>}</form>}
    {error && <div className="library-error" role="alert">{error} <Button onClick={reload}>Tentar de novo</Button></div>}
    {loading ? <SkeletonBody label="Carregando biblioteca…" cards={4} columns={4} cardHeight={320} /> : !error ? <>
      <div className="library-result"><p role="status">{countLabel(page?.items.length ?? 0)} nesta página</p>{compact && filtered && <Button size="sm" variant="ghost" onClick={() => setParams({})}>Limpar filtros</Button>}</div>
      {page?.items.length ? <div className="library-grid">{page.items.map(item => <LibraryCard key={item.id} item={item} onEdit={() => { if (!busy) void edit(item); }} onDelete={() => { if (!busy) { setDeleteError(""); setDeleting(item); } }} />)}</div> : <LibraryEmpty filtered={filtered} hasMore={!!page?.nextCursor} onAdd={() => setForm({})} onClear={() => setParams({})} />}
      <nav className="library-pagination" aria-label="Páginas da biblioteca"><Button disabled={!cursor} onClick={() => { const next = new URLSearchParams(params); next.delete("cursor"); setParams(next); }}>Primeira página</Button><Button disabled={!page?.nextCursor} onClick={() => { const next = new URLSearchParams(params); next.set("cursor", page!.nextCursor!); setParams(next); }}>Próxima página</Button></nav>
    </> : null}
    {compact && <Button className="library-fab" variant="primary" aria-label="Adicionar obra" title="Adicionar obra" onClick={() => setForm({})} disabled={busy}><Plus size={24} aria-hidden="true" /></Button>}
    {sheet && <LibraryFilterSheet status={status} tag={tag} onClose={() => setSheet(false)} onApply={values => { setSheet(false); filter(values); }} />}
    {form && <LibraryForm existing={form.existing} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    <ConfirmDialog open={!!deleting} title="Excluir obra?" confirmLabel="Excluir obra" busyLabel="Excluindo…" busy={busy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void remove()}><p>A obra “{deleting?.title}” será excluída. Esta ação não pode ser desfeita.</p></ConfirmDialog>
  </section>;
}

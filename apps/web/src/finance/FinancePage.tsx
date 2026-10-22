import { useEffect, useState } from 'react';
import { getFinanceBalances, listTransactions, getFinanceSummary, listAllBanks, exportFinanceCsv, type Bank } from '../lib/finance-api';
import { formatMoney } from './money';
import { Link, useNavigate } from 'react-router-dom';
import { FinanceAccess } from './FinanceAccess';
import { TransactionForm } from './TransactionForm';
import { BanksModal } from './BanksModal';
import { usePageTitle } from '../lib/use-page-title';
import './finance.css';

export default function FinancePage() {
  usePageTitle('Finanças');
  return <FinanceAccess><FinanceList /></FinanceAccess>;
}
function FinanceList() {
  const navigate = useNavigate();
  const [page, setPage] = useState<Awaited<ReturnType<typeof listTransactions>>>();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getFinanceSummary>>>();
  const [balances, setBalances] = useState<Awaited<ReturnType<typeof getFinanceBalances>>>();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showBanks, setShowBanks] = useState(false);
  const [exporting, setExporting] = useState(false);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    Promise.all([listTransactions(cursor, abort.signal), getFinanceSummary(abort.signal), listAllBanks(abort.signal), getFinanceBalances(abort.signal)])
      .then(([nextPage, totals, bankItems, balanceItems]) => { if (!abort.signal.aborted) { setBalances(balanceItems); setPage(nextPage); setSummary(totals); setBanks(bankItems); } })
      .catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Falha ao carregar finanças.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [cursor, revision]);
  function reload() { setCursors([undefined]); setRevision(value => value + 1); }
  async function exportCsv() {
    setExporting(true); setError('');
    try {
      const blob = await exportFinanceCsv(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'financas.csv'; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : 'Falha ao exportar.'); }
    finally { setExporting(false); }
  }
  return <section className="finance-page" aria-labelledby="finance-title">
    <header className="finance-heading"><div><div className="eyebrow">SEU DINHEIRO, COM CLAREZA</div><h1 id="finance-title">Finanças<em>.</em></h1><p className="finance-muted">Entradas, saídas e os bancos do seu dia a dia.</p></div><div className="finance-actions"><button onClick={() => setShowBanks(true)} disabled={loading}>Bancos</button><button onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? 'Exportando…' : 'Exportar CSV'}</button><button onClick={() => setCreating(true)} disabled={loading}>Novo lançamento</button></div></header>
    {error && <div role="alert" className="finance-error">{error} <button onClick={reload}>Recarregar dados</button></div>}
    {loading ? <p role="status">Carregando finanças…</p> : !error ? <>
      <section aria-label="Balanço geral"><h2>Balanço geral</h2><p className="finance-muted">Referências de abertura + movimentos posteriores das contas + movimentos sem conta. Moedas são mantidas separadas.</p><div className="finance-totals">{balances?.currencies.map(total => <article key={total.currency}><span>{total.currency}</span><strong>{formatMoney(total.balanceCents, total.currency)}</strong><small>Sem conta: {formatMoney(total.unallocatedCents, total.currency)}</small></article>)}</div></section>
      <section aria-label="Saldo por instituição"><h2>Suas instituições</h2><div className="finance-totals">{balances?.banks.map(bank => <article key={bank.bankId ?? 'none'}><h3>{bank.title}</h3>{bank.currencies.length ? bank.currencies.map(total => <p key={total.currency}>{formatMoney(total.balanceCents, total.currency)}</p>) : <p>Sem saldo registrado</p>}</article>)}</div></section>
      <h2>Movimentação registrada</h2><p className="finance-muted">Totais dos lançamentos, sem somar referências de abertura.</p>
      <div className="finance-totals" aria-label="Totais de todos os lançamentos">{summary?.currencies.length ? summary.currencies.map(total => <article key={total.currency}><span className="finance-eyebrow">Movimento líquido · {total.currency}</span><strong>{formatMoney(total.balanceCents, total.currency)}</strong><p>Entradas <b>{formatMoney(total.incomeCents, total.currency)}</b></p><p>Saídas <b>{formatMoney(total.expenseCents, total.currency)}</b></p><small>{total.count} lançamento(s) · todas as páginas</small></article>) : <article><span className="finance-eyebrow">Seu panorama</span><strong>Sem lançamentos</strong><p>Crie o primeiro para acompanhar seus totais.</p></article>}</div>
      <div className="finance-table-wrap"><table><caption>Lançamentos · página {cursors.length}</caption><thead><tr><th>Título</th><th>Categoria</th><th>Banco</th><th>Entrada / saída</th><th>Data</th><th>Tags</th></tr></thead><tbody>{page?.items.map(item => <tr key={item.id} onClick={() => navigate(`/finance/${item.id}`)}><td><Link className="finance-title-button" to={`/finance/${item.id}`} onClick={event => event.stopPropagation()}>{item.title}</Link></td><td>{item.category}</td><td>{item.bankTitle ?? '—'}</td><td>{item.direction === 'income' ? 'Entrada' : 'Saída'}<br /><b>{formatMoney(item.amountCents, item.currency)}</b></td><td>{item.date.split('-').reverse().join('/')}</td><td>{item.tags.length ? item.tags.join(', ') : '—'}</td></tr>)}</tbody></table></div>
      {!page?.items.length && <p className="finance-empty">Nenhum lançamento nesta página. Registre uma entrada ou saída para começar.</p>}
      <nav className="finance-pagination" aria-label="Páginas dos lançamentos"><button disabled={cursors.length < 2} onClick={() => setCursors(values => values.slice(0, -1))}>Anterior</button><span>Página {cursors.length} · até 50 itens</span><button disabled={!page?.nextCursor} onClick={() => setCursors(values => [...values, page?.nextCursor ?? undefined])}>Próxima</button></nav>
    </> : null}
    {creating && <TransactionForm banks={banks} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); navigate(`/finance/${saved.id}`); }} />}
    {showBanks && <BanksModal banks={banks} balances={balances} onClose={() => setShowBanks(false)} onChanged={reload} />}

  </section>;
}

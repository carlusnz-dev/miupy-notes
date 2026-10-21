import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteTransaction, getTransaction, listAllBanks, type Bank, type Transaction } from '../lib/finance-api';
import { usePageTitle } from '../lib/use-page-title';
import { FinanceAccess } from './FinanceAccess';
import { TransactionForm } from './TransactionForm';
import { formatMoney } from './money';
const methods = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outro' };
const links = { none: 'Sem vínculo', salary: 'Salário', monthlyBills: 'Contas do mês' };
export default function FinanceDetailPage() {
  const { id = '' } = useParams();
  usePageTitle('Detalhe do lançamento');
  return <FinanceAccess><FinanceDetail key={id} id={id} /></FinanceAccess>;
}
function FinanceDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [item, setItem] = useState<Transaction>();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setItem(undefined);
    Promise.all([getTransaction(id,abort.signal),listAllBanks(abort.signal)]).then(([transaction,bankItems]) => {
      if (!abort.signal.aborted) { setItem(transaction); setBanks(bankItems); }
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Falha ao carregar lançamento.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  },[id,revision]);
  async function remove() {
    if (!item) return;
    setDeleting(true); setError('');
    try { await deleteTransaction(item.id,item.version); navigate('/finance'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao excluir.'); }
    finally { setDeleting(false); }
  }
  return <section className="finance-page"><Link to="/finance">← Voltar às finanças</Link>
    {loading ? <p role="status">Carregando lançamento…</p> : <>
      {error && <p role="alert">{error} <button onClick={() => setRevision(value => value+1)}>Recarregar lançamento</button></p>}
      {item && <><header className="finance-heading"><div><p className="finance-eyebrow">Lançamento</p><h1>{item.title}</h1></div><div className="finance-actions"><button disabled={deleting} onClick={() => setEditing(true)}>Editar lançamento</button><button disabled={deleting} onClick={() => void remove()}>{deleting ? 'Excluindo…' : 'Excluir lançamento'}</button></div></header>
        <dl className="finance-detail"><dt>Valor</dt><dd>{formatMoney(item.amountCents,item.currency)}</dd><dt>Tipo / categoria</dt><dd>{item.direction === 'income' ? 'Entrada' : 'Saída'} · {item.category}</dd><dt>Data</dt><dd>{item.date.split('-').reverse().join('/')}</dd><dt>Banco (no lançamento)</dt><dd>{item.bankTitle ?? 'Sem banco'}</dd><dt>Origem</dt><dd>{item.source}</dd><dt>Vínculo</dt><dd>{links[item.link]} {item.linkedMonth ?? ''}</dd>{item.paymentMethod && <><dt>Método de pagamento</dt><dd>{methods[item.paymentMethod]}</dd></>}{item.direction === 'expense' && item.paymentMethod === 'card' && <><dt>Parcelas</dt><dd>{item.installmentCount == null ? 'Não informado' : item.installmentCount === 1 ? 'À vista' : `${item.installmentCount} parcelas`}</dd></>}<dt>Tags</dt><dd>{item.tags.join(', ') || 'Sem tags'}</dd></dl>
      </>}
    </>}
    {editing && item && <TransactionForm existing={item} banks={banks} onClose={() => setEditing(false)} onSaved={saved => { setItem(saved); setEditing(false); setError(''); }} />}
  </section>;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAllBanks, getFinanceBalances, deleteBank, type Bank, type Balances } from '../lib/finance-api';
import { usePageTitle } from '../lib/use-page-title';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { FinanceAccess } from './FinanceAccess';
import { BanksModal, logoSource } from './BanksModal';
import { AccountsPanel } from './AccountsPanel';
import './finance.css';

export default function BanksPage() {
  usePageTitle('Bancos e contas');
  return <FinanceAccess><BanksList /></FinanceAccess>;
}
function BanksList() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [balances, setBalances] = useState<Balances>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Bank | null | undefined>();
  const [removing, setRemoving] = useState<Bank>();
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    Promise.all([listAllBanks(abort.signal), getFinanceBalances(abort.signal)])
      .then(([items, totals]) => { if (!abort.signal.aborted) { setBanks(items); setBalances(totals); } })
      .catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Falha ao carregar bancos.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);
  async function remove() {
    if (!removing) return;
    setBusy(true); setError('');
    try { await deleteBank(removing.id, removing.version); setRemoving(undefined); reload(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Falha ao excluir banco.'); }
    finally { setBusy(false); }
  }
  return <section className="finance-page" aria-labelledby="banks-title">
    <Link className="text-link" to="/finance">Voltar às finanças</Link>
    <PageHeader size="utility" id="banks-title" className="finance-heading" title="Bancos e contas" description="Instituições e referências das suas contas." actions={<Button variant="primary" disabled={loading || accountBusy} onClick={() => setEditing(null)}>Novo banco</Button>} />
    {error && !removing && <p role="alert">{error} <Button onClick={reload}>Tentar novamente</Button></p>}
    {loading ? <p role="status">Carregando bancos…</p> : <>
      <section aria-labelledby="banks-list-title"><h2 id="banks-list-title">Instituições</h2><p className="finance-muted">Bancos e cooperativas usados nos seus lançamentos.</p><ul className="finance-banks">{banks.map(bank => <li key={bank.id}>{bank.logo && <img src={logoSource(bank.logo)} alt="" referrerPolicy="no-referrer" />}<span>{bank.title}</span><Button disabled={accountBusy} onClick={() => setEditing(bank)}>Editar <span className="finance-sr">{bank.title}</span></Button><Button variant="danger" disabled={accountBusy} onClick={() => { setError(''); setRemoving(bank); }}>Excluir <span className="finance-sr">{bank.title}</span></Button></li>)}</ul>
      {!banks.length && !error && <p>Nenhum banco cadastrado. Adicione uma instituição para organizar suas contas.</p>}</section>
      <AccountsPanel banks={banks} balances={balances} onChanged={reload} onBusyChange={setAccountBusy} />
    </>}
    {editing !== undefined && <BanksModal bank={editing ?? undefined} onClose={() => setEditing(undefined)} onChanged={reload} />}
    <ConfirmDialog open={!!removing} title="Excluir banco?" confirmLabel="Excluir banco" busy={busy} error={error || null} onConfirm={() => void remove()} onCancel={() => setRemoving(undefined)}><p>O nome histórico será mantido nos lançamentos existentes.</p></ConfirmDialog>
  </section>;
}

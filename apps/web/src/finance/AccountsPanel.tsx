import { useState, type FormEvent } from 'react';
import { saveAccount, type Account, type AccountInput, type Balances, type Bank } from '../lib/finance-api';
import Input from '../components/Input';
import Button from '../components/Button';
import DatePicker from '../components/DatePicker';
import Select from '../components/Select';
import { formatMoney } from './money';

export function AccountsPanel({ banks, balances, onChanged, onBusyChange }: { banks: Bank[]; balances?: Balances; onChanged: () => void; onBusyChange: (busy: boolean) => void }) {
  const [editing, setEditing] = useState<Account>();
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');
  const [currency, setCurrency] = useState<AccountInput['currency']>('BRL');
  const today = new Date().toLocaleDateString('en-CA');
  const [openingDate, setOpeningDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    // Entrada explícita em centavos, inclusive negativos, sem conversão decimal com float.
    const text = String(data.get('openingBalanceCents'));
    const cents = Number(text);
    if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(cents)) { setError('Informe centavos inteiros dentro do limite de precisão.'); return; }
    setBusy(true); onBusyChange(true); setError('');
    try {
      await saveAccount({ title: String(data.get('title')), bankId: editing?.bankId ?? bankId, currency: editing?.currency ?? currency, openingBalanceCents: cents, openingDate: String(data.get('openingDate')) }, editing);
      setEditing(undefined); setOpeningDate(today); form.reset(); onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível salvar a conta.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section><h3>Contas e saldos</h3><p className="finance-muted">Uma instituição pode ter várias contas. A referência é o saldo no início da data escolhida; lançamentos da conta nessa data ou depois são somados uma vez.</p>
    {balances?.accounts.map(account => <article className="finance-account" key={account.id}><strong>{account.title} · {banks.find(b => b.id === account.bankId)?.title ?? 'Instituição removida'}</strong><p>Calculado: {formatMoney(account.balanceCents, account.currency)}</p><small>Referência manual: {formatMoney(account.openingBalanceCents, account.currency)} em {account.openingDate} · atualizada em {new Date(account.updatedAt).toLocaleString('pt-BR')}</small><button disabled={busy} onClick={() => { setEditing(account); setOpeningDate(account.openingDate); setError(''); }}>Editar conta</button></article>)}
    <form className="finance-form" onSubmit={submit} key={editing?.id ?? 'new'}><h3>{editing ? 'Editar conta' : 'Nova conta'}</h3><fieldset disabled={busy}>
      <Input label="Nome da conta" name="title" maxLength={120} defaultValue={editing?.title} required />
      {editing ? <p>{banks.find(b => b.id === editing.bankId)?.title} · {editing.currency}</p> : <><Select label="Instituição da conta" value={bankId} options={[{ value: '', label: 'Escolha uma instituição' }, ...banks.map(b => ({ value: b.id, label: b.title }))]} onChange={setBankId} /><Select label="Moeda da conta" value={currency} options={(['BRL', 'USD', 'EUR'] as const).map(value => ({ value, label: value }))} onChange={setCurrency} /></>}
      <Input label="Saldo de referência em centavos" name="openingBalanceCents" inputMode="numeric" defaultValue={editing?.openingBalanceCents ?? 0} pattern="-?[0-9]+" required hint="Ex.: 12345 = 123,45; negativo representa saldo devedor." error={error || undefined} />
      <DatePicker label="Saldo no início desta data" name="openingDate" value={openingDate} onChange={setOpeningDate} required disabled={busy} />
    </fieldset><footer>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setOpeningDate(today); }}>Nova conta</button>}<Button type="submit" variant="primary" loading={busy} disabled={!editing && !bankId}>Salvar conta</Button></footer></form>
  </section>;
}

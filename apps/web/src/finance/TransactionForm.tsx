import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';
import { listAllAccounts, type Account, saveTransaction, type Bank, type Transaction, type TransactionInput } from '../lib/finance-api';
import { monthNames, todayLocal, toIso } from '../lib/calendar-date';
import DatePicker from '../components/DatePicker';
import MoneyInput from '../components/MoneyInput';
import Select from '../components/Select';
import { Modal } from './Modal';
import Button from '../components/Button';

type Direction = TransactionInput['direction'];
type Link = TransactionInput['link'];
type Method = NonNullable<TransactionInput['paymentMethod']>;
type Currency = TransactionInput['currency'];
const currencies = [{ value: 'BRL', label: 'BRL' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }] as const;
const directions = [{ value: 'expense', label: 'Saída' }, { value: 'income', label: 'Entrada' }] as const;
const methods = [{ value: 'pix', label: 'Pix' }, { value: 'card', label: 'Cartão' }, { value: 'cash', label: 'Dinheiro' }, { value: 'transfer', label: 'Transferência' }, { value: 'other', label: 'Outro' }] as const;
const links = [{ value: 'none', label: 'Sem vínculo' }, { value: 'salary', label: 'Salário' }, { value: 'monthlyBills', label: 'Contas do mês' }] as const;
const today = () => toIso(todayLocal());
const MIN_INSTALLMENTS = 2, MAX_INSTALLMENTS = 120;
const validInstallments = (text: string) => /^\d{1,3}$/.test(text) && Number(text) >= MIN_INSTALLMENTS && Number(text) <= MAX_INSTALLMENTS;

// Mês de referência (AAAA-MM) como dois selects: o seletor nativo de mês tem o tema do sistema.
function MonthField({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const [year, month] = value.split('-');
  const thisYear = new Date().getFullYear();
  const first = Math.min(thisYear - 5, Number(year));
  const years = Array.from({ length: Math.max(thisYear + 2, Number(year)) - first + 1 }, (_, index) => String(first + index));
  return <div className="finance-grid">
    <Select label="Mês de referência" value={month} options={monthNames.map((name, index) => ({ value: String(index + 1).padStart(2, '0'), label: name[0].toUpperCase() + name.slice(1) }))} onChange={next => onChange(`${year}-${next}`)} />
    <Select label="Ano de referência" value={year} options={years.map(item => ({ value: item, label: item }))} onChange={next => onChange(`${next}-${month}`)} />
  </div>;
}

export function TransactionForm({ existing, banks, onClose, onSaved }: { existing?: Transaction; banks: Bank[]; onClose: () => void; onSaved: (transaction: Transaction) => void }) {
  const [step, setStep] = useState(0);
  const stepRef = useRef<HTMLFieldSetElement>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  useEffect(() => {
    const abort = new AbortController();
    listAllAccounts(abort.signal).then(items => { if (!abort.signal.aborted) setAccounts(items); })
      .catch(() => { if (!abort.signal.aborted) setAccountError('Não foi possível carregar as contas. Feche e tente novamente.'); });
    return () => abort.abort();
  }, []);
  useLayoutEffect(() => {
    const panel = stepRef.current;
    if (!panel) return;
    panel.querySelector<HTMLElement>(':scope > div:not([hidden]) :is(input, button, select)')?.focus();
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(panel, { opacity: 0, x: step ? 18 : -18 }, { opacity: 1, x: 0, duration: .25, clearProps: 'opacity,transform' });
    });
    return () => media.revert();
  }, [step]);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [amountCents, setAmountCents] = useState<number | null>(existing?.amountCents ?? null);
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'BRL');
  const [direction, setDirection] = useState<Direction>(existing?.direction ?? 'expense');
  const [date, setDate] = useState(existing?.date ?? today());
  const [category, setCategory] = useState(existing?.category ?? '');
  const [bankId, setBankId] = useState(existing?.bankId ?? '');
  const [method, setMethod] = useState<Method>(existing?.paymentMethod ?? 'pix');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [source, setSource] = useState(existing?.source ?? 'Manual');
  const [link, setLink] = useState<Link>(existing?.link ?? 'none');
  const [month, setMonth] = useState(existing?.linkedMonth ?? today().slice(0, 7));
  // Parcelas: só despesa no cartão. Lançamento antigo de cartão (contagem null) fica "não informado" até o usuário decidir.
  const [parceled, setParceled] = useState((existing?.installmentCount ?? 0) >= MIN_INSTALLMENTS);
  const [installmentText, setInstallmentText] = useState(existing?.installmentCount && existing.installmentCount >= MIN_INSTALLMENTS ? String(existing.installmentCount) : '');
  const [installmentsTouched, setInstallmentsTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isCard = direction === 'expense' && method === 'card';
  const legacyUnknown = !!existing && existing.direction === 'expense' && existing.paymentMethod === 'card' && existing.installmentCount === null && !installmentsTouched;
  const installmentError = isCard && parceled && !validInstallments(installmentText) ? `Informe um número inteiro de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.` : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !category.trim()) { setStep(0); setError('Informe título e categoria.'); return; }
    if (!amountCents || amountCents < 1) { setError('Informe um valor maior que zero.'); return; }
    if (step === 1 && installmentError) { setError(installmentError); return; }
    if (!date) { setError('Informe uma data válida.'); return; }
    if (step === 0) { setStep(1); setError(''); return; }
    setBusy(true); setError('');
    try {
      // Campos condicionais só seguem no payload quando visíveis: método só em saída, mês só com vínculo.
      const saved = await saveTransaction({ title, amountCents, currency, direction, date, category, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        bankId: bankId || null, accountId: accountId || null, source, link, linkedMonth: link === 'none' ? null : month,
        paymentMethod: direction === 'income' ? null : method,
        // Fora de saída/cartão: null (limpa). À vista: 1. Antigo sem decisão: null (continua "não informado").
        installmentCount: !isCard ? null : parceled ? Number(installmentText) : legacyUnknown ? null : 1,
      }, existing);
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  const bankOptions = [{ value: '', label: 'Sem banco' }, ...(existing?.bankId && !banks.some(b => b.id === existing.bankId) ? [{ value: existing.bankId, label: `${existing.bankTitle} (removido)` }] : []), ...banks.map(bank => ({ value: bank.id, label: bank.title }))];
  return <Modal title={existing ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose} busy={busy}>
    <p className="finance-muted" aria-live="polite">Etapa {step + 1} de 2 · {step === 0 ? 'Valor e classificação' : 'Conta e detalhes'}</p>
    <form onSubmit={submit} className="finance-form"><fieldset ref={stepRef} disabled={busy}>
      <div hidden={step !== 0}><fieldset disabled={step !== 0}>
      <label>Título<input autoFocus data-autofocus name="title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} required /></label>
      <div className="finance-grid"><MoneyInput label={isCard && parceled ? 'Valor total da compra' : 'Valor'} name="amount" value={amountCents} currency={currency} onChange={setAmountCents} required />
      <Select label="Moeda" name="currency" value={currency} options={currencies} onChange={value => { setCurrency(value); setAccountId(''); }} /></div>
      <div className="finance-grid"><Select label="Tipo" value={direction} options={directions} onChange={setDirection} />
      <DatePicker label="Data" name="date" value={date} onChange={setDate} required /></div>
      <label>Categoria<input name="category" maxLength={80} value={category} onChange={e => setCategory(e.target.value)} required /></label>
      </fieldset></div><div hidden={step !== 1}><fieldset disabled={step !== 1}>
      {accountError && <p role="alert">{accountError}</p>}
      <Select label="Instituição" name="bank" value={bankId} options={bankOptions} onChange={value => { setBankId(value); setAccountId(''); }} />
      <Select label="Conta" value={accountId} options={[{ value: '', label: 'Sem conta (movimento não alocado)' }, ...accounts.filter(a => a.bankId === bankId).map(a => ({ value: a.id, label: `${a.title} · ${a.currency}` }))]} onChange={value => { setAccountId(value); const account = accounts.find(a => a.id === value); if (account) setCurrency(account.currency); }} />
      <p className="finance-muted">A moeda acompanha a conta escolhida. Sem conta, o lançamento continua no balanço como movimento não alocado.</p>
      {direction === 'expense' && <Select label="Método de pagamento" name="method" value={method} options={methods} onChange={setMethod} />}
      {isCard && <fieldset className="finance-installments">
        <label className="finance-check"><input type="checkbox" name="parceled" checked={parceled} onChange={e => { setParceled(e.target.checked); setInstallmentsTouched(true); }} /> Compra parcelada</label>
        {legacyUnknown && !parceled && <p className="finance-muted">Parcelamento não informado neste lançamento antigo.</p>}
        {parceled && <label>Número de parcelas
          <input name="installments" type="number" inputMode="numeric" min={MIN_INSTALLMENTS} max={MAX_INSTALLMENTS} step={1} value={installmentText} required aria-invalid={installmentError ? true : undefined} aria-describedby="installments-help"
            ref={element => element?.setCustomValidity(installmentError)} onChange={e => setInstallmentText(e.target.value)} />
          <span id="installments-help" className="finance-muted">O valor informado é o total da compra, não o de cada parcela.</span>
          {installmentError && <span role="alert">{installmentError}</span>}
        </label>}
      </fieldset>}
      <label>Tags (separadas por vírgula)<input name="tags" value={tags} onChange={e => setTags(e.target.value)} /></label>
      <label>Origem<input name="source" maxLength={200} value={source} onChange={e => setSource(e.target.value)} required /></label>
      <Select label="Vínculo" value={link} options={links} onChange={setLink} />
      {link !== 'none' && <MonthField value={month} onChange={setMonth} />}
    </fieldset></div></fieldset>{error && <p role="alert">{error}</p>}<footer><Button onClick={onClose} disabled={busy}>Cancelar</Button>{step === 1 && <Button disabled={busy} onClick={() => setStep(0)}>Voltar</Button>}<Button variant="primary" type="submit" disabled={busy || (step === 1 && !!accountError)}>{busy ? 'Salvando…' : step === 0 ? 'Continuar' : 'Salvar lançamento'}</Button></footer></form>
  </Modal>;
}

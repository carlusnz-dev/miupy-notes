import { useState, type FormEvent } from 'react';
import { saveTransaction, type Bank, type Transaction, type TransactionInput } from '../lib/finance-api';
import { parseCents } from './money';
import { Modal } from './Modal';
export function TransactionForm({ existing, banks, onClose, onSaved }: { existing?: Transaction; banks: Bank[]; onClose: () => void; onSaved: (transaction: Transaction) => void }) {
  const [direction, setDirection] = useState<TransactionInput['direction']>(existing?.direction ?? 'expense');
  const [link, setLink] = useState<TransactionInput['link']>(existing?.link ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amountCents = parseCents(String(data.get('amount')));
    if (!amountCents) { setError('Informe um valor positivo com até duas casas decimais.'); return; }
    setBusy(true); setError('');
    try {
      const saved = await saveTransaction({ title: String(data.get('title')), amountCents, currency: data.get('currency') as TransactionInput['currency'], direction,
        date: String(data.get('date')), category: String(data.get('category')), tags: String(data.get('tags')).split(',').map(t => t.trim()).filter(Boolean),
        bankId: String(data.get('bank')) || null, source: String(data.get('source')), link, linkedMonth: link === 'none' ? null : String(data.get('month')),
        paymentMethod: direction === 'income' ? null : data.get('method') as TransactionInput['paymentMethod'],
      }, existing);
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  return <Modal title={existing ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="finance-form"><fieldset disabled={busy}>
      <label>Título<input autoFocus data-autofocus name="title" maxLength={200} defaultValue={existing?.title} required /></label>
      <div className="finance-grid"><label>Valor<input name="amount" inputMode="decimal" defaultValue={existing ? (existing.amountCents / 100).toFixed(2) : ''} placeholder="0,00" required /></label>
      <label>Moeda<select aria-label="Moeda" name="currency" defaultValue={existing?.currency ?? 'BRL'}><option>BRL</option><option>USD</option><option>EUR</option></select></label></div>
      <div className="finance-grid"><label>Tipo<select aria-label="Tipo" value={direction} onChange={e => setDirection(e.target.value as TransactionInput['direction'])}><option value="expense">Saída</option><option value="income">Entrada</option></select></label>
      <label>Data<input type="date" name="date" defaultValue={existing?.date ?? new Date().toLocaleDateString('en-CA')} required /></label></div>
      <label>Categoria<input name="category" maxLength={80} defaultValue={existing?.category} required /></label>
      <label>Banco<select aria-label="Banco" name="bank" defaultValue={existing?.bankId ?? ''}><option value="">Sem banco</option>{existing?.bankId && !banks.some(b => b.id === existing.bankId) && <option value={existing.bankId}>{existing.bankTitle} (removido)</option>}{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.title}</option>)}</select></label>
      {direction === 'expense' && <label>Método de pagamento<select aria-label="Método de pagamento" name="method" defaultValue={existing?.paymentMethod ?? 'pix'}><option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>}
      <label>Tags (separadas por vírgula)<input name="tags" defaultValue={existing?.tags.join(', ')} /></label>
      <label>Origem<input name="source" maxLength={200} defaultValue={existing?.source ?? 'Manual'} required /></label>
      <label>Vínculo<select aria-label="Vínculo" value={link} onChange={e => setLink(e.target.value as TransactionInput['link'])}><option value="none">Sem vínculo</option><option value="salary">Salário</option><option value="monthlyBills">Contas do mês</option></select></label>
      {link !== 'none' && <label>Mês de referência<input name="month" type="month" defaultValue={existing?.linkedMonth ?? ''} required /></label>}
    </fieldset>{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar lançamento'}</button></footer></form>
  </Modal>;
}

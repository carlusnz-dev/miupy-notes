// Harness sintético de desenvolvimento; não é importado pelo aplicativo.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TransactionForm } from '../src/finance/TransactionForm';
import { BanksModal } from '../src/finance/BanksModal';
import Sidebar from '../src/components/Sidebar';
import { apiClient, setAccessTokenProvider } from '../src/lib/api-client';
import tokens from '../../../styles/tokens.json';
import '../src/App.css';
import '../src/finance/finance.css';

const colors = {
  background: tokens.colors.background, surface: tokens.colors.surface,
  'surface-raised': tokens.colors.surfaceRaised, text: tokens.colors.text,
  muted: tokens.colors.textMuted, border: tokens.colors.border,
  'border-strong': tokens.colors.borderStrong, focus: tokens.colors.focus,
};
for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--color-${key}`, value);
document.documentElement.style.setProperty('--font-serif', 'Instrument Serif, Georgia, serif');
const metadata = { createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z', version: 1 };
const bank = { ...metadata, id: '11111111-1111-4111-8111-111111111111', title: 'Instituição sintética', logo: null };
const account = { ...metadata, id: '22222222-2222-4222-8222-222222222222', title: 'Corrente sintética', bankId: bank.id, currency: 'BRL' as const, source: 'manual' as const, openingDate: '2026-10-01', openingBalanceCents: 10000 };
const balances = { calculatedAt: metadata.updatedAt, accounts: [{ ...account, movementCents: -2000, balanceCents: 8000 }], banks: [{ bankId: bank.id, title: bank.title, currencies: [{ currency: 'BRL' as const, balanceCents: 8000 }] }], currencies: [{ currency: 'BRL' as const, balanceCents: 8000, unallocatedCents: 0 }] };
setAccessTokenProvider(async () => 'synthetic-only');
apiClient.defaults.adapter = async config => {
  const body = config.data ? JSON.parse(config.data) : {};
  const data = config.method === 'get'
    ? { items: [account], nextCursor: null }
    : { ...body, ...metadata, accountId: body.accountId ?? null, id: bank.id, bankTitle: null };
  // A resposta de conta usa seu schema próprio e nunca carrega dados de transação.
  if (config.url?.includes('/accounts') && config.method !== 'get') { delete data.accountId; delete data.bankTitle; }
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
function Preview() {
  const [open, setOpen] = useState(false);
  const [institutions, setInstitutions] = useState(false);
  const [saved, setSaved] = useState('');
  return <BrowserRouter><div className="app-shell"><Sidebar /><main style={{ padding: 32 }}>
    <h1>Validação sintética financeira</h1>
    <button onClick={() => setOpen(true)}>Novo lançamento</button>
    <button onClick={() => setInstitutions(true)}>Instituições</button>
    <p id="saved">{saved}</p>
    {open && <TransactionForm banks={[bank]} onClose={() => setOpen(false)} onSaved={value => { setSaved(JSON.stringify(value)); setOpen(false); }} />}
    {institutions && <BanksModal banks={[bank]} balances={balances} onClose={() => setInstitutions(false)} onChanged={() => setSaved('Conta salva')} />}
  </main></div></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);

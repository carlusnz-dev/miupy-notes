import type { ReactNode } from 'react';
import { signIn, useAuth } from '../lib/auth';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import './finance.css';
export function FinanceAccess({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'signed-in') return children;
  return <section className="finance-page"><PageHeader title="Finanças" />{auth.status === 'checking' ? <p role="status">Verificando sua conta…</p> : auth.status === 'unsupported' ? <p>Abra o aplicativo desktop para conectar sua conta Google e acessar suas finanças.</p> : <><p>Conecte sua conta para acessar seus lançamentos e bancos.</p><Button variant="primary" onClick={() => void signIn()} disabled={auth.signingIn}>{auth.signingIn ? 'Conectando…' : 'Entrar com Google'}</Button></>}{auth.error && <p role="alert">{auth.error}</p>}</section>;
}

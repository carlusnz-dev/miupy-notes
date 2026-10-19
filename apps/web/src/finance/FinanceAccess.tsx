import type { ReactNode } from 'react';
import { signIn, useAuth } from '../lib/auth';
import './finance.css';
export function FinanceAccess({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'signed-in') return children;
  return <section className="finance-page"><h1>Finanças</h1>{auth.status === 'checking' ? <p role="status">Verificando sua conta…</p> : auth.status === 'unsupported' ? <p>Abra o aplicativo desktop para conectar sua conta Google e acessar suas finanças.</p> : <><p>Conecte sua conta para acessar seus lançamentos e bancos.</p><button onClick={() => void signIn()} disabled={auth.signingIn}>{auth.signingIn ? 'Conectando…' : 'Entrar com Google'}</button></>}{auth.error && <p role="alert">{auth.error}</p>}</section>;
}

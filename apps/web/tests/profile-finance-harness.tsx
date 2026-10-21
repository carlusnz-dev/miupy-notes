// Fixture sintética: mock IPC antes de importar auth, sem login ou token real.
import type { CSSProperties } from 'react';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import tokens from '../../../styles/tokens.json';
import '../src/App.css';

const mode = new URLSearchParams(location.search).get('mode');
Object.assign(globalThis, { isTauri: true });
mockIPC(command => {
  if (command === 'auth_status') return { signedIn: mode !== 'signed-out' };
  if (command === 'auth_id_token') {
    if (mode === 'profile-error') throw new Error('Falha sintética de perfil.');
    return `synthetic.${btoa(JSON.stringify({ sub: 'synthetic-owner', name: 'Perfil sintético' }))}.synthetic`;
  }
  throw new Error('Comando não previsto no harness.');
});
const { initAuth } = await import('../src/lib/auth');
await initAuth();
const { setAccessTokenProvider } = await import('../src/lib/api-client');
if (mode !== 'signed-out') setAccessTokenProvider(async () => 'synthetic-only');
const { default: ProfilePage } = await import('../src/ProfilePage');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const theme = {
  '--color-background': tokens.colors.background, '--color-surface': tokens.colors.surface,
  '--color-text': tokens.colors.text, '--color-muted': tokens.colors.textMuted,
  '--color-border': tokens.colors.border, '--color-border-strong': tokens.colors.borderStrong,
} as CSSProperties;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><BrowserRouter><div className="app-shell" style={theme}>
    <main className="page-scroll"><div className="page-content"><ProfilePage /></div></main>
  </div></BrowserRouter></QueryClientProvider>,
);

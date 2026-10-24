import { lazy, Suspense, useLayoutEffect, useRef, type CSSProperties } from "react";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import tokens from "../../../styles/tokens.json";
import ScrollActivity from "./components/ScrollActivity";
import Sidebar from "./components/Sidebar";
import BottomNav from "./components/BottomNav";
import NotesPage from "./NotesPage";
import Home from "./Home";
import ArrowIcon from "./components/ArrowIcon";
import PageTransition from "./components/PageTransition";
import { SkeletonBody } from "./components/Skeleton";

// O editor (CodeMirror + prévia Markdown) só carrega ao abrir uma nota.
const NoteEditorPage = lazy(() => import("./NoteEditorPage"));
// Perfil traz o Recharts; configurações só carregam quando abertas.
const ProfilePage = lazy(() => import("./ProfilePage"));
const FinanceDetailPage = lazy(() => import("./finance/FinanceDetailPage"));
const BanksPage = lazy(() => import("./finance/BanksPage"));
const FinancePage = lazy(() => import("./finance/FinancePage"));
const LibraryPage = lazy(() => import("./library/LibraryPage"));
const CalendarPage = lazy(() => import("./calendar/CalendarPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));
import { usePageTitle } from "./lib/use-page-title";
import "./App.css";
import "./account-nav.css";
import "./components/touch.css";

const sections = [
  { path: "/notes", label: "Notas", description: "Ideias, páginas e conexões em um lugar." },
  { path: "/agendas", label: "Agendas", description: "Compromissos e tempo com contexto." },
  { path: "/finance", label: "Finanças", description: "Movimentos e decisões com clareza." },
  { path: "/library", label: "Biblioteca", description: "Livros, filmes e músicas que ficaram." },
] as const;

const theme = {
  "--color-background": tokens.colors.background,
  "--color-surface": tokens.colors.surface,
  "--color-surface-raised": tokens.colors.surfaceRaised,
  "--color-text": tokens.colors.text,
  "--color-muted": tokens.colors.textMuted,
  "--color-border": tokens.colors.border,
  "--color-border-strong": tokens.colors.borderStrong,
  "--color-accent": tokens.colors.accent,
  "--color-accent-text": tokens.colors.accentText,
  "--color-focus": tokens.colors.focus,
  "--radius-small": `${tokens.radiusPx.small}px`,
  "--radius-medium": `${tokens.radiusPx.medium}px`,
  "--duration": `${tokens.motion.defaultDurationMs}ms`,
} as CSSProperties;

function NotFound() {
  const { pathname } = useLocation();
  usePageTitle("Página não encontrada");
  return (
    <div className="feature-page">
      <div className="eyebrow">CAMINHO NÃO ENCONTRADO</div>
      <h1>404<em>.</em></h1>
      <p className="lead">Nenhuma página corresponde a <code>{pathname}</code> neste espaço.</p>
      <NavLink className="text-link" to="/">Voltar ao início <ArrowIcon /></NavLink>
    </div>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);
  const pageName = pathname === "/"
    ? "Visão geral"
    : pathname.startsWith("/notes/")
      ? "Editor de notas"
      : pathname === "/finance/banks"
        ? "Bancos e contas"
      : pathname.startsWith("/finance/")
        ? "Lançamento financeiro"
      : pathname === "/profile"
        ? "Perfil"
        : pathname === "/settings"
          ? "Configurações"
          : sections.find((section) => section.path === pathname)?.label ?? "Página não encontrada";

  return (
    <div className="app-shell" style={theme}>
      <div className="mesh" aria-hidden="true"><span /><span /></div>
      {/* HashRouter usa o hash como rota: o link só move o foco, sem mudar a URL. */}
      <a className="skip-link" href="#conteudo" onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}>Pular para o conteúdo</a>
      <ScrollActivity />
      <Sidebar />
      <main className="main-content" id="conteudo" ref={mainRef} tabIndex={-1}>
        <header className="topbar">
          <span>miupy / notes / <span className="topbar-page" aria-current="page">{pageName}</span></span>
        </header>
        <div className="page-scroll" ref={scrollRef}>
          <div className="page-content">
            <PageTransition pathname={pathname}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:id" element={
                  <Suspense fallback={<SkeletonBody label="Carregando editor…" lines={2} cards={1} cardHeight={380} />}>
                    <NoteEditorPage />
                  </Suspense>
                } />
                <Route path="/settings" element={
                  <Suspense fallback={<SkeletonBody label="Carregando configurações…" lines={4} />}>
                    <SettingsPage />
                  </Suspense>
                } />
                <Route path="/profile" element={
                  <Suspense fallback={<SkeletonBody label="Carregando perfil…" cards={4} cardHeight={120} columns={2} />}>
                    <ProfilePage />
                  </Suspense>
                } />
                <Route path="/finance/banks" element={<Suspense fallback={<SkeletonBody label="Carregando bancos…" lines={4} />}><BanksPage /></Suspense>} />
                <Route path="/finance/:id" element={<Suspense fallback={<SkeletonBody label="Carregando lançamento…" lines={4} />}><FinanceDetailPage /></Suspense>} />
                <Route path="/finance" element={<Suspense fallback={<SkeletonBody label="Carregando finanças…" lines={4} />}><FinancePage /></Suspense>} />
                <Route path="/agendas" element={<Suspense fallback={<SkeletonBody label="Carregando agendas…" lines={3} cards={1} cardHeight={320} />}><CalendarPage /></Suspense>} />
                {/* Atalhos antigos (Sidebar e Início) apontavam para /events. */}
                <Route path="/events" element={<Navigate to="/agendas" replace />} />
                <Route path="/library" element={<Suspense fallback={<SkeletonBody label="Carregando biblioteca…" cards={4} />}><LibraryPage /></Suspense>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </PageTransition>
          </div>
        </div>
        <footer className="app-footer">
          <span>miupy notes</span>
          <span>Seu acervo, seu tempo.</span>
        </footer>
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter><Shell /></HashRouter>
  );
}

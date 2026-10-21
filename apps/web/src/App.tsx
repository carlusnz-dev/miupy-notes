import { lazy, Suspense, useLayoutEffect, useRef, type CSSProperties } from "react";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import tokens from "../../../styles/tokens.json";
import Sidebar from "./components/Sidebar";
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
const FinancePage = lazy(() => import("./finance/FinancePage"));
const CalendarPage = lazy(() => import("./calendar/CalendarPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));
import { usePageTitle } from "./lib/use-page-title";
import "./App.css";
import "./account-nav.css";

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

function Feature({ label, description }: { label: string; description: string }) {
  usePageTitle(label);
  return (
    <div className="feature-page">
      <div className="eyebrow">EM PREPARAÇÃO</div>
      <h1>{label}<em>.</em></h1>
      <p className="lead">{description}</p>
      <p className="muted">Este espaço ainda não armazena dados. O primeiro fluxo será conectado à API após definir a autenticação.</p>
      <NavLink className="text-link" to="/">Voltar ao início <ArrowIcon /></NavLink>
    </div>
  );
}

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
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);
  const pageName = pathname === "/"
    ? "Visão geral"
    : pathname.startsWith("/notes/")
      ? "Editor de notas"
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
      <Sidebar />
      <main className="main-content">
        <header className="topbar">
          <span>miupy / notes</span>
          <span>{pageName}</span>
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
                <Route path="/finance/:id" element={<Suspense fallback={<SkeletonBody label="Carregando lançamento…" lines={4} />}><FinanceDetailPage /></Suspense>} />
                <Route path="/finance" element={<Suspense fallback={<SkeletonBody label="Carregando finanças…" lines={4} />}><FinancePage /></Suspense>} />
                <Route path="/agendas" element={<Suspense fallback={<SkeletonBody label="Carregando agendas…" lines={3} cards={1} cardHeight={320} />}><CalendarPage /></Suspense>} />
                {/* Atalhos antigos (Sidebar e Início) apontavam para /events. */}
                <Route path="/events" element={<Navigate to="/agendas" replace />} />
                {sections.filter((section) => section.path !== "/notes" && section.path !== "/finance" && section.path !== "/agendas").map((section) => (
                  <Route key={section.path} path={section.path} element={<Feature label={section.label} description={section.description} />} />
                ))}
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
    </div>
  );
}

export default function App() {
  return (
    <HashRouter><Shell /></HashRouter>
  );
}

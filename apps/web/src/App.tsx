import type { CSSProperties } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import tokens from "../../../styles/tokens.json";
import "./App.css";

const sections = [
  { path: "/notes", label: "Notas", description: "Ideias, páginas e conexões em um lugar." },
  { path: "/events", label: "Agenda", description: "Compromissos e tempo com contexto." },
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

// As fontes locais não têm "↗"; o SVG evita fallback para fonte do sistema.
function ArrowIcon() {
  return (
    <svg className="arrow-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path d="M4 12 12 4M5.5 4H12v6.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function Home() {
  return (
    <>
      <div className="eyebrow">SEU ESPAÇO PESSOAL</div>
      <h1>Uma vida, <em>em perspectiva.</em></h1>
      <p className="lead">Notas, agenda, finanças e cultura reunidas com calma. A base está pronta para crescer com os seus dados.</p>
      <div className="section-heading"><span>Espaços</span><span>01 — 04</span></div>
      <div className="section-grid">
        {sections.map((section, index) => (
          <NavLink className="section-card" to={section.path} key={section.path}>
            <span className="card-index">0{index + 1}</span>
            <span className="card-bottom"><strong>{section.label}</strong><ArrowIcon /></span>
            <small>{section.description}</small>
          </NavLink>
        ))}
      </div>
    </>
  );
}

function Feature({ label, description }: { label: string; description: string }) {
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
  return (
    <div className="feature-page">
      <div className="eyebrow">CAMINHO NÃO ENCONTRADO</div>
      <h1>404<em>.</em></h1>
      <p className="lead">Esta página não existe neste espaço.</p>
      <NavLink className="text-link" to="/">Voltar ao início <ArrowIcon /></NavLink>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell" style={theme}>
        <div className="mesh" aria-hidden="true"><span /><span /></div>
        <aside className="sidebar">
          <NavLink className="brand" to="/" aria-label="miupy notes, início">
            <img src="/mark.svg" alt="" width="34" height="34" />
            <span>miupy<span className="brand-light"> / notes</span></span>
          </NavLink>
          <div className="nav-caption">ESPAÇOS</div>
          <nav aria-label="Navegação principal">
            <NavLink end to="/">Visão geral</NavLink>
            {sections.map((section) => <NavLink key={section.path} to={section.path}>{section.label}</NavLink>)}
          </nav>
          <div className="sidebar-footer">Um lugar para o que importa.</div>
        </aside>
        <main className="main-content">
          <header className="topbar"><span>miupy / notes</span><span>ESTRUTURA INICIAL · 2026</span></header>
          <div className="page-content">
            <Routes>
              <Route path="/" element={<Home />} />
              {sections.map((section) => <Route key={section.path} path={section.path} element={<Feature label={section.label} description={section.description} />} />)}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
          <footer className="app-footer"><span>miupy notes</span><span>Seu acervo, seu tempo.</span></footer>
        </main>
      </div>
    </HashRouter>
  );
}

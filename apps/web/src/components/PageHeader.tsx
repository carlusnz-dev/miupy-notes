import type { ReactNode } from "react";

/**
 * Cabeçalho único das páginas: eyebrow opcional, h1 serif, descrição e ações.
 * `hub` (~60 px) para as seções principais; `utility` (~40 px) para telas de apoio.
 * O ponto final do título é regra única; `dot={false}` só para títulos vindos de dados.
 * Os estilos ficam em typography.css (carregado globalmente por App.css).
 */
export default function PageHeader({ title, size = "hub", eyebrow, description, actions, id, className = "", dot = true }: {
  title: ReactNode;
  size?: "hub" | "utility";
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** id do h1, para aria-labelledby da seção. */
  id?: string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <header className={`page-header page-header-${size} ${className}`.trim()}>
      <div className="page-header-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 id={id}>{title}{dot && <em>.</em>}</h1>
        {description && <p className="lead">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

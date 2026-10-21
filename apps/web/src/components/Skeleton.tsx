import type { CSSProperties } from "react";
import "./skeleton.css";

type SkeletonProps = { width?: CSSProperties["width"]; height?: CSSProperties["height"]; radius?: CSSProperties["borderRadius"]; className?: string };

/** Bloco animado no lugar de um dado que ainda vai chegar. Decorativo: quem anuncia o carregamento é `SkeletonBody`. */
export function Skeleton({ width = "100%", height = 14, radius, className = "" }: SkeletonProps) {
  return <span className={`skeleton ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

type SkeletonBodyProps = {
  /** Texto lido por leitores de tela, por exemplo "Carregando notas…". */
  label: string;
  /** Linhas de texto (larguras variadas). */
  lines?: number;
  /** Blocos do tamanho de um cartão ou linha de lista. */
  cards?: number;
  /** Altura de cada cartão. */
  cardHeight?: number;
  /** Colunas da grade de cartões (1 empilha). */
  columns?: number;
  className?: string;
};

const lineWidths = ["92%", "78%", "86%", "64%", "71%"];

/** Esqueleto de corpo de página: substitui spinner e mantém o layout estável enquanto o dado chega. */
export function SkeletonBody({ label, lines = 0, cards = 0, cardHeight = 64, columns = 1, className = "" }: SkeletonBodyProps) {
  return (
    <div className={`skeleton-body ${className}`} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, index) => <Skeleton key={`line-${index}`} width={lineWidths[index % lineWidths.length]} />)}
      {cards > 0 && (
        <div className="skeleton-cards" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: cards }, (_, index) => <Skeleton key={`card-${index}`} height={cardHeight} radius="var(--radius-medium)" className="skeleton-card" />)}
        </div>
      )}
    </div>
  );
}

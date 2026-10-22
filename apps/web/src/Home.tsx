import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import gsap from "gsap";
import ButtonGroup from "./components/ButtonGroup";
import ArrowIcon from "./components/ArrowIcon";
import { SkeletonBody } from "./components/Skeleton";
import { ApiError } from "./lib/api-client";
import { useAuth } from "./lib/auth";
import { computeNoteStats, type DayCount } from "./lib/note-stats";
import { useNotesSummary } from "./lib/notes-queries";
import { usePageTitle } from "./lib/use-page-title";
import type { NoteOutput } from "./lib/notes-api";

const periods = [7, 30, 90] as const;
// Texto visível = nome acessível (WCAG 2.5.3): "30d" com aria-label "30 dias" divergia.
const periodOptions = periods.map((days) => ({ value: days, label: `${days} dias` }));
const numberFormat = new Intl.NumberFormat("pt-BR");
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const spaces = [
  { path: "/notes", label: "Notas", description: "Ideias e conexões" },
  { path: "/agendas", label: "Agenda", description: "Tempo com contexto" },
  { path: "/finance", label: "Finanças", description: "Movimentos e decisões" },
  { path: "/library", label: "Biblioteca", description: "Obras que ficaram" },
];

function Sparkline({ values, total, days }: { values: DayCount[]; total: number; days: number }) {
  const max = Math.max(1, ...values.map((day) => day.count));
  const points = values
    .map((day, index) => `${(index / Math.max(1, values.length - 1)) * 100},${28 - (day.count / max) * 23}`)
    .join(" ");

  return (
    <svg
      className="dashboard-sparkline"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${numberFormat.format(total)} ${total === 1 ? "nota criada" : "notas criadas"} nos últimos ${days} dias`}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function previewState(name: string | null) {
  if (!import.meta.env.DEV || !name) return null;
  if (name === "deslogado") return { status: "signed-out" as const };
  if (name === "carregando" || name === "erro") return { status: name };
  if (name !== "vazio" && name !== "lista") return null;

  const now = new Date();
  const sample = (daysAgo: number, body: string, tags: string[]): NoteOutput => ({
    id: crypto.randomUUID(),
    title: "Nota de exemplo",
    body,
    tags,
    createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    updatedAt: now.toISOString(),
    folderId: null, version: 1,
  });
  return {
    status: "ready" as const,
    items: name === "vazio" ? [] : [
      sample(0, "Uma ideia para guardar.", ["ideias"]),
      sample(2, "Outro registro da semana.", ["ideias", "pessoal"]),
      sample(12, "Uma lembrança.", ["pessoal"]),
    ],
  };
}

export default function Home() {
  usePageTitle("Visão geral");
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const previewName = searchParams.get("estado");
  const preview = useMemo(() => previewState(previewName), [previewName]);
  const [windowDays, setWindowDays] = useState<(typeof periods)[number]>(30);
  const query = useNotesSummary(windowDays, preview === null);
  const status = preview?.status ?? (
    auth.status === "checking" ? "carregando"
      : auth.status !== "signed-in" ? "unavailable"
        : query.data ? "ready" : query.isError ? "erro" : "carregando"
  );
  const stats = useMemo(() => preview?.status === "ready" ? computeNoteStats(preview.items ?? [], windowDays) : query.data, [preview, query.data, windowDays]);
  const error = query.error instanceof ApiError ? query.error : null;

  const periodContent = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (status !== "ready" || !periodContent.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(periodContent.current, { opacity: .35, y: 4 }, { opacity: 1, y: 0, duration: .3, ease: "power2.inOut", clearProps: "opacity,transform" });
    });
    return () => media.revert();
  }, [windowDays, status]);

  return (
    <div className="home-page">
      <header className="home-intro">
        <div className="eyebrow">VISÃO GERAL</div>
        <h1>Seu espaço<em>.</em></h1>
        <p className="lead">{dateFormat.format(new Date())} · Um panorama das suas notas.</p>
      </header>
      <section className="dashboard" aria-labelledby="dashboard-title">
        <div className="dashboard-heading">
          <h2 id="dashboard-title">Em números</h2>
          <Link className="dashboard-link" to="/notes">
            Ver notas <ArrowIcon direction="right" size={16} />
          </Link>
        </div>
        {(status === "unavailable" || status === "signed-out") && (
          <div className="state-panel">
            <strong>Métricas indisponíveis</strong>
            <p>Entre no app desktop e conecte sua conta para ver o panorama das notas.</p>
            <Link className="text-link" to="/notes">
              Ir para Notas <ArrowIcon direction="right" />
            </Link>
          </div>
        )}
        {status === "carregando" && <SkeletonBody label="Carregando métricas…" cards={3} cardHeight={152} columns={3} />}
        {status === "erro" && (
          <div className="state-panel">
            <strong>Não foi possível carregar as métricas</strong>
            <p>{error?.code === "FORBIDDEN" ? "Esta conta não tem acesso a esta API." : error?.message ?? "Tente de novo em instantes."}</p>
            {error?.requestId && <p className="muted-small">Código do pedido: <code>{error.requestId}</code></p>}
            <button className="button button-secondary" type="button" onClick={() => void query.refetch()} disabled={!!preview}>
              Tentar de novo
            </button>
          </div>
        )}
        {status === "ready" && stats && (
          <>
            <div className="dashboard-grid">
              <article className="metric-card metric-period">
                <div className="metric-top">
                  <span>Novas notas</span>
                  <ButtonGroup label="Período das novas notas" options={periodOptions} value={windowDays} onChange={setWindowDays} />
                </div>
                <div ref={periodContent} className="period-content">
                  <strong>{numberFormat.format(stats.createdInWindow)}</strong>
                  <Sparkline values={stats.createdPerDay} total={stats.createdInWindow} days={windowDays} />
                  <small>Nos últimos {windowDays} dias</small>
                </div>
              </article>
              <article className="metric-card">
                <span>Palavras escritas</span>
                <strong>{numberFormat.format(stats.words)}</strong>
                <small>Em {numberFormat.format(stats.total)} {stats.total === 1 ? "nota" : "notas"}</small>
              </article>
              <article className="metric-card">
                <span>Tags existentes</span>
                <strong>{numberFormat.format(stats.tags.length)}</strong>
                <div className="metric-tags">
                  {stats.tags.slice(0, 3).map(({ tag, count }) => (
                    <span className="tag" key={tag}>{tag} <b>{count}</b></span>
                  ))}
                  {stats.tags.length === 0 && <small>Nenhuma tag ainda</small>}
                </div>
              </article>
            </div>
            <div className="dashboard-footnotes">
              {!preview && query.isFetching && <span role="status">Atualizando…</span>}
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="spaces-title">
        <div className="section-heading"><h2 id="spaces-title">Espaços</h2><span>01 — 04</span></div>
        <div className="section-grid">
          {spaces.map((space, index) => (
            <Link className="section-card" to={space.path} key={space.path}>
              <span className="card-index">0{index + 1}</span>
              <span className="card-bottom">
                <strong>{space.label}</strong>
                <ArrowIcon />
              </span>
              <small>{space.description}</small>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

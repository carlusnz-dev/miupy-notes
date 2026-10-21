import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SkeletonBody } from "./components/Skeleton";
import SignOutButton from "./components/SignOutButton";
import { getProfile, useAuth } from "./lib/auth";
import { computeNoteDetails, computeNoteStats } from "./lib/note-stats";
import { useNotesSummary } from "./lib/notes-queries";
import { usePageTitle } from "./lib/use-page-title";
import type { NoteOutput } from "./lib/notes-api";
import "./profile.css";

type Profile = Awaited<ReturnType<typeof getProfile>>;
const sampleNotes: NoteOutput[] = ["Ideias de domingo", "Leituras", "Projeto pessoal"].map((title, index) => ({ id: String(index), title, body: "Uma nota de exemplo com algumas palavras para o perfil.", tags: index ? ["pessoal"] : ["ideias", "pessoal"], createdAt: new Date(Date.now() - index * 86_400_000).toISOString(), updatedAt: new Date().toISOString(), folderId: null, version: 1 }));
const chartColor = "#F5F5F2";
const muted = "#A6A6A2";
function Chart({ title, summary, data, x, horizontal = false }: { title: string; summary: string; data: Record<string, string | number>[]; x: string; horizontal?: boolean }) {
  return <section className="profile-chart"><h3>{title}</h3><p>{summary}</p><div className="profile-chart-plot" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, bottom: 8, left: horizontal ? 16 : 0 }}><CartesianGrid stroke="#343436" vertical={false} />{horizontal ? <><XAxis type="number" stroke={muted} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey={x} width={90} stroke={muted} tick={{ fontSize: 11 }} /></> : <><XAxis dataKey={x} stroke={muted} tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.slice(5)} minTickGap={24} /><YAxis stroke={muted} tick={{ fontSize: 11 }} allowDecimals={false} /></>}<Tooltip contentStyle={{ background: "#202022", color: chartColor, border: "1px solid #343436" }} /><Bar dataKey="count" fill={chartColor} radius={[2, 2, 0, 0]} isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches} /></BarChart></ResponsiveContainer></div></section>;
}
export default function ProfilePage() {
  usePageTitle("Perfil");
  const auth = useAuth();
  const [params] = useSearchParams();
  const state = import.meta.env.DEV ? params.get("estado") : null;
  const [profile, setProfile] = useState<Profile>(null);
  const [profileError, setProfileError] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = useNotesSummary();
  useEffect(() => { if (auth.status !== "signed-in") return; let active = true; getProfile().then((value) => { if (active) setProfile(value); }).catch(() => { if (active) setProfileError(true); }); return () => { active = false; }; }, [auth.status, retry]);
  const preview = state === "lista" || state === "vazio" || state === "carregando" || state === "erro";
  const signedOut = state === "deslogado" || (auth.status !== "signed-in" && !preview);
  const loading = state === "carregando" || (!preview && auth.status === "signed-in" && query.isPending);
  const error = state === "erro" || (!preview && (query.isError || profileError));
  const notes = useMemo(() => state === "lista" ? sampleNotes : [], [state]);
  const stats = useMemo(() => preview ? computeNoteStats(notes) : query.data ?? computeNoteStats([]), [notes, preview, query.data]);
  const details = useMemo(() => preview ? computeNoteDetails(notes) : query.data ?? computeNoteDetails([]), [notes, preview, query.data]);
  const date = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)) : "—";
  const initials = (profile?.name || profile?.email || "U").split(/[\s@]+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return <div className="profile-page"><div className="eyebrow">SEU ACERVO</div><h1>Perfil<em>.</em></h1>
    {signedOut ? <div className="state-panel"><strong>Perfil indisponível no navegador</strong><p>Entre pelo aplicativo desktop para ver seus dados e suas métricas.</p></div> : <>
      <section className="profile-identity"><div className="profile-avatar" aria-hidden="true">{initials}</div><div><strong>{profile?.name ?? (preview ? "Usuário de exemplo" : "Conta Google")}</strong><span>{profile?.email ?? "Google"}</span><small>Provedor: Google</small></div>{!preview && <SignOutButton />}</section>
      {loading ? <SkeletonBody label="Carregando perfil" cards={6} lines={2} /> : error ? <div className="state-panel"><strong>Não foi possível carregar o perfil.</strong><button type="button" className="button button-secondary" onClick={() => { setProfileError(false); setRetry((value) => value + 1); void query.refetch(); }}>Tentar de novo</button></div> : <>
        {stats.total === 0 && <div className="state-panel"><strong>Ainda não há notas.</strong><p>As métricas aparecerão depois que você criar a primeira nota.</p></div>}
        <div className="profile-stats">{[["Notas", stats.total], ["Palavras", stats.words], ["Caracteres", details.characters], ["Tags distintas", stats.tags.length], ["Média de palavras", details.averageWords], ["Primeira nota", date(details.first)], ["Última nota", date(details.last)]].map(([label, value]) => <div className="profile-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="profile-charts"><Chart title="Notas criadas por dia" summary={`${stats.createdInWindow} notas criadas nos últimos 30 dias.`} data={stats.createdPerDay} x="date" /><Chart title="Tags mais usadas" summary={`${stats.tags.length} tags distintas; até oito exibidas.`} data={stats.tags.slice(0, 8).map(({ tag, count }) => ({ tag, count }))} x="tag" horizontal /><Chart title="Palavras por nota" summary={`Até dez notas com mais palavras; média de ${details.averageWords} palavras.`} data={details.topNotes.map(({ title, words }) => ({ title, count: words }))} x="title" horizontal /></div>
        <div className="profile-future">{["Agenda", "Biblioteca"].map((label) => <div key={label} className="profile-stat"><span>{label}</span><strong>0</strong><small>Em preparação</small></div>)}</div>
      </>}
    </>}
  </div>;
}

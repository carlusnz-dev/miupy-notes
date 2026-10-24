import { useState } from "react";
import type { LibraryItem } from "../lib/library-api";
import { kindLabel, statusLabel } from "./labels";
import Button from "../components/Button";

export default function LibraryCard({ item, onEdit, onDelete }: { item: LibraryItem; onEdit: () => void; onDelete: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const typographic = !item.coverUrl || failedUrl === item.coverUrl;
  return <article className={`library-card library-card-${item.kind}`}>
    <button className="library-cover" onClick={onEdit} aria-label={`Editar ${item.title}`}>
      {!typographic && item.coverUrl ? <img src={item.coverUrl} alt="" width={360} height={400} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(item.coverUrl)} /> : <span className="library-cover-type"><span>{kindLabel[item.kind]}</span><strong>{item.title}</strong><span>{item.creator || "Seu próximo encontro"}</span></span>}
    </button>
    <div className="library-card-info"><div className="library-card-meta"><span>{statusLabel(item.status)}</span><span aria-label={item.rating === null ? "Sem avaliação" : `Nota ${item.rating} de 5`}>{item.rating === null ? "Sem nota" : `★ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(item.rating)}`}</span></div>
      {typographic
        // A capa já mostra título e autor: a legenda não repete, mas o nome do card continua no título oculto.
        ? <><h2 className="visually-hidden">{item.title}{item.creator ? ` — ${item.creator}` : ""}</h2>{item.year && <p className="library-year">{item.year}</p>}</>
        : <><h2><button onClick={onEdit}>{item.title}</button></h2><p>{item.creator || kindLabel[item.kind]}{item.year ? ` (${item.year})` : ""}</p></>}
      {item.comment && <p className="library-comment">{item.comment}</p>}
      {item.tags.length > 0 && <p className="library-tags">{item.tags.map((tag, index) => <span key={`${tag}:${index}`}>{tag}</span>)}</p>}
      <div className="library-card-actions">{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">Abrir link<span className="visually-hidden"> de {item.title} em nova aba</span></a>}<Button variant="danger" size="sm" onClick={onDelete} aria-label={`Excluir ${item.title}`}>Excluir</Button></div>
    </div>
  </article>;
}

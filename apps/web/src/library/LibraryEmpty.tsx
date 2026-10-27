import Button from "../components/Button";
import { emptyContent } from "./view";

/** Acervo vazio (CTA: adicionar) ou busca/filtro sem correspondência (CTA: limpar filtros). */
export default function LibraryEmpty({ filtered, hasMore, onAdd, onClear }: { filtered: boolean; hasMore: boolean; onAdd: () => void; onClear: () => void }) {
  const { kind, title, text, action } = emptyContent(filtered, hasMore);
  return <div className="library-empty" data-empty={kind}>
    {kind === "empty-library" && <span aria-hidden="true">Aa</span>}
    <h2>{title}</h2>
    <p>{text}</p>
    <Button variant={filtered ? "secondary" : "primary"} onClick={filtered ? onClear : onAdd}>{action}</Button>
  </div>;
}

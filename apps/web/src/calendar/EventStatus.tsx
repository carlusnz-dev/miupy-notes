import { Lock } from "lucide-react";
import type { DisplayStatus } from "./outbox";

const labels: Record<DisplayStatus, string | null> = {
  synced: null,
  pending: "Só neste dispositivo",
  conflict: "Conflito",
  rejected: "Recusado",
};

/** Selo de estado de envio. Eventos sincronizados não ganham selo; "só neste dispositivo" nunca diz "salvo na nuvem". */
export default function EventStatus({ status }: { status: DisplayStatus }) {
  const label = labels[status];
  return label ? <span className={`calendar-status calendar-status-${status}`}>{label}</span> : null;
}

/** Selo de evento do Google (somente leitura): cadeado além da borda pontilhada, para não depender só do traço. `text` acrescenta o texto para leitores de tela onde não há `aria-label`. */
export function SourceMark({ text = false }: { text?: boolean }) {
  return <><Lock className="calendar-source-mark" size={11} aria-hidden="true" />{text && <span className="visually-hidden">Google, somente leitura. </span>}</>;
}

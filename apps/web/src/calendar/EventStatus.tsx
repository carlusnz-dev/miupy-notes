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

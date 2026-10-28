import { useState } from "react";
import Button from "../components/Button";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import { toIso, todayLocal } from "../lib/calendar-date";
import { pauseHabit, type Habit } from "../lib/habits-api";

/** Pausa a partir de uma data, com retomada opcional (dia em que volta a valer). */
export default function PauseDialog({ habit, onClose, onSaved }: { habit: Habit; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(toIso(todayLocal())), [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    if (!from) { setError("Informe a data de início da pausa."); return; }
    if (until && until <= from) { setError("A retomada deve ser posterior ao início da pausa."); return; }
    setBusy(true); setError("");
    try { await pauseHabit(habit, from, until || null); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível pausar. Tente de novo."); }
    finally { setBusy(false); }
  }
  return <Modal open title="Pausar hábito" onClose={onClose} busy={busy} className="habits-modal">
    <p className="habits-hint">“{habit.title}” não gera ocorrências durante a pausa. Sem data de retomada, ela vale até você retomar.</p>
    <div className="habits-form-grid"><DatePicker label="Pausar a partir de" value={from} onChange={setFrom} /><DatePicker label="Retomar em (opcional)" value={until} onChange={setUntil} /></div>
    {error && <p role="alert" className="habits-error">{error}</p>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Pausando…" : "Pausar"}</Button></div>
  </Modal>;
}

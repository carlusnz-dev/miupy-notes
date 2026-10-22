import { useId, useMemo, useState, type FormEvent } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import Select from "../components/Select";
import TimeField from "../components/TimeField";
import Badge from "../components/Badge";
import type { CalendarEventOutput, EventDraft, EventLink, GoogleStatusOutput } from "../lib/calendar-api";
import { timeRange, zoneNote } from "./format";
import type { DisplayEvent } from "./outbox";
import { buildDraft, initialFields, type Fields } from "./draft";
import { browserZone, zoneChoices } from "./time";

export type NoteChoice = { id: string; title: string };
type Reflector = { reflect: (id: string) => Promise<void>; unreflect: (id: string, keepRemote: boolean) => Promise<void> };

export default function EventForm({ open, entry, day, notes, notesState, events, google, reflector, onClose, onSubmit, onDelete, onResolve, onDiscard }: {
  open: boolean;
  /** Evento aberto; nulo = novo. */
  entry: DisplayEvent | null;
  day: { year: number; month: number; day: number };
  notes: NoteChoice[];
  notesState: "loading" | "ready" | "unavailable";
  events: CalendarEventOutput[];
  google: GoogleStatusOutput | null;
  reflector: Reflector | null;
  onClose: () => void;
  onSubmit: (draft: EventDraft) => Promise<void>;
  onDelete: () => Promise<void>;
  onResolve: (choice: "mine" | "server") => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const event = entry?.event ?? null;
  const [fields, setFields] = useState<Fields>(() => initialFields(event, day));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteToAdd, setNoteToAdd] = useState("");
  const [eventToAdd, setEventToAdd] = useState("");
  const ids = { title: useId(), description: useId(), location: useId() };
  const canWriteGoogle = google?.state === "connected" && google.mode === "reflect";
  const readOnly = event?.readOnly === true && !canWriteGoogle;
  const [sendToGoogle, setSendToGoogle] = useState(event?.reflection !== null && event?.reflection !== undefined);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const zones = useMemo(() => zoneChoices(fields.timeZone, event?.timeZone, browserZone()), [fields.timeZone, event?.timeZone]);
  const op = entry?.op ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) {
      // A janela continua aberta com tudo o que foi digitado.
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível concluir. Seus dados continuam no formulário.");
    } finally { setBusy(false); }
  }

  function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    const built = buildDraft(fields);
    if ("error" in built) { setError(built.error); return; }
    void run(async () => { await onSubmit({ ...built.draft, ...(event?.source !== "google" && canWriteGoogle ? { sendToGoogle } : {}) }); onClose(); });
  }

  const linkLabel = (link: EventLink) => link.kind === "note" ? (notes.find((note) => note.id === link.id)?.title ?? "Nota indisponível") : (events.find((item) => item.id === link.id)?.title ?? "Evento indisponível");
  const addLink = (kind: EventLink["kind"], id: string) => { if (id && !fields.links.some((link) => link.kind === kind && link.id === id)) set("links", [...fields.links, { kind, id }]); };
  // Memoizadas: sem isso, cada tecla no título refazia as listas (todas as notas e todos os eventos carregados).
  const noteOptions = useMemo(() => [{ value: "", label: notesState === "loading" ? "Carregando notas…" : notesState === "unavailable" ? "Notas indisponíveis agora" : "Escolher nota…" }, ...notes.filter((note) => !fields.links.some((link) => link.kind === "note" && link.id === note.id)).map((note) => ({ value: note.id, label: note.title }))], [notes, notesState, fields.links]);
  const eventOptions = useMemo(() => [{ value: "", label: "Escolher evento…" }, ...events.filter((item) => item.id !== event?.id && !fields.links.some((link) => link.kind === "event" && link.id === item.id)).map((item) => ({ value: item.id, label: item.title }))], [events, event?.id, fields.links]);
  const zoneInfo = event ? zoneNote(event) : null;

  return (
    <>
    <Modal open={open} title={readOnly ? "Evento do Google" : event ? "Editar evento" : "Novo evento"} onClose={onClose} busy={busy} className="calendar-modal">
      {readOnly && event ? (
        <div className="calendar-readonly">
          <h3>{event.title}</h3>
          <p>{timeRange(event)}{zoneInfo ? ` · ${zoneInfo}` : ""}</p>
          {event.location && <p>{event.location}</p>}
          {event.description && <p className="calendar-description">{event.description}</p>}
          <p className="calendar-note">Espelho somente leitura do Google Calendar. Para alterar, edite no Google e sincronize.</p>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Fechar</button></div>
        </div>
      ) : (
        <form className="calendar-form" onSubmit={submit} noValidate>
          {op?.state === "conflict" && (
            <div className="calendar-alert" role="alert">
              <strong>Conflito de versões.</strong>
              <p>{op.serverCopy ? `O evento foi alterado em outro lugar ("${op.serverCopy.title}"). Nada foi sobrescrito.` : "O evento foi removido em outro lugar. Nada foi recriado."}</p>
              <div className="calendar-alert-actions">
                <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await onResolve("mine"); onClose(); })}>{op.serverCopy ? "Manter o meu" : "Recriar o meu"}</button>
                <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await onResolve("server"); onClose(); })}>Usar o do servidor</button>
              </div>
            </div>
          )}
          {op?.state === "rejected" && (
            <div className="calendar-alert" role="alert">
              <strong>O servidor recusou este envio.</strong>
              <p>Corrija os dados abaixo e salve de novo, ou descarte o rascunho.</p>
              <div className="calendar-alert-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await onDiscard(); onClose(); })}>Descartar rascunho</button></div>
            </div>
          )}
          <div className="calendar-field">
            <label htmlFor={ids.title}>Título</label>
            <input id={ids.title} data-autofocus value={fields.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required />
          </div>
          <label className="calendar-check"><input type="checkbox" checked={fields.allDay} onChange={(e) => set("allDay", e.target.checked)} /> Dia inteiro</label>
          <div className="calendar-pair">
            <DatePicker label="Início" value={fields.startDate} onChange={(value) => { set("startDate", value); if (value && (!fields.endDate || fields.endDate < value)) set("endDate", value); }} required />
            {!fields.allDay && <TimeField label="Hora de início" value={fields.startTime} onChange={(value) => set("startTime", value)} required />}
          </div>
          <div className="calendar-pair">
            <DatePicker label="Fim" value={fields.endDate} onChange={(value) => set("endDate", value)} required />
            {!fields.allDay && <TimeField label="Hora de fim" value={fields.endTime} onChange={(value) => set("endTime", value)} required />}
          </div>
          {!fields.allDay && <Select label="Fuso horário" value={fields.timeZone} options={zones.map((zone) => ({ value: zone, label: zone }))} onChange={(zone) => set("timeZone", zone)} />}
          <div className="calendar-field">
            <label htmlFor={ids.location}>Local</label>
            <input id={ids.location} value={fields.location} maxLength={300} onChange={(e) => set("location", e.target.value)} />
          </div>
          <div className="calendar-field">
            <label htmlFor={ids.description}>Descrição</label>
            <textarea id={ids.description} rows={3} value={fields.description} maxLength={8000} onChange={(e) => set("description", e.target.value)} />
          </div>
          {event?.source !== "google" && <fieldset className="calendar-links">
            <legend>Relações</legend>
            {fields.links.length > 0 && <div className="calendar-link-list">{fields.links.map((link) => <Badge key={`${link.kind}:${link.id}`} onRemove={() => set("links", fields.links.filter((item) => item !== link))}>{`${link.kind === "note" ? "Nota" : "Evento"}: ${linkLabel(link)}`}</Badge>)}</div>}
            <Select label="Nota" value={noteToAdd} options={noteOptions} disabled={notesState !== "ready"} onChange={(id) => { addLink("note", id); setNoteToAdd(""); }} />
            <Select label="Outro evento" value={eventToAdd} options={eventOptions} onChange={(id) => { addLink("event", id); setEventToAdd(""); }} />
            <p className="calendar-note">Biblioteca: módulo ainda indisponível, sem relações por enquanto.</p>
          </fieldset>}
          {canWriteGoogle && event?.source !== "google" && <label className="calendar-check"><input type="checkbox" checked={sendToGoogle || !!event?.reflection} disabled={!!event?.reflection} onChange={(e) => setSendToGoogle(e.target.checked)} /> {event?.reflection ? "Salvar também atualiza no Google; excluir remove de lá." : "Enviar este evento ao Google ao salvar"}</label>}
          {event?.source === "google" && canWriteGoogle && <p className="calendar-note">Salvar altera este evento no Google. Excluir também o remove do Google. Mudanças remotas concorrentes geram conflito.</p>}
          {event && event.source !== "google" && google?.state === "connected" && google.mode === "reflect" && reflector && (
            <div className="calendar-reflect">
              <strong>Google Calendar</strong>
              {event.reflection
                ? <p>{event.reflection.inSync ? "Enviado ao Google. Alterações salvas serão enviadas novamente." : "O Google está com uma versão anterior deste evento."}</p>
                : <p>Este evento não está no Google. Enviar é uma ação sua, evento a evento.</p>}
              {op ? <p className="calendar-note">Há alterações só neste dispositivo: envie-as ao servidor antes de enviar ao Google.</p>
                : <div className="calendar-alert-actions">
                  <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(() => reflector.reflect(event.id))}>{event.reflection ? "Atualizar no Google" : "Enviar ao Google"}</button>
                  {event.reflection && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(() => reflector.unreflect(event.id, false))}>Remover do Google</button>}
                </div>}
            </div>
          )}
          {error && <p className="calendar-error" role="alert">{error}</p>}
          <div className="modal-actions">
            {event && <button type="button" className="button button-secondary calendar-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>Excluir</button>}
            <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
            <button type="submit" className="button" disabled={busy}>{busy ? "Guardando…" : "Salvar"}</button>
          </div>
          <p className="calendar-note">Ao salvar, a alteração fica guardada neste dispositivo e é enviada ao servidor assim que houver conexão.</p>
        </form>
      )}
    </Modal>
    {/* Irmão do formulário (não filho): o <dialog> de confirmação fica no topo e o de baixo vira inerte. */}
    <ConfirmDialog open={open && confirmDelete} title="Excluir este evento?" confirmLabel="Excluir evento" busyLabel="Excluindo…" busy={busy} error={confirmDelete ? error : null}
      onCancel={() => setConfirmDelete(false)} onConfirm={() => void run(async () => { await onDelete(); setConfirmDelete(false); onClose(); })}>
      <p>{event?.reflection ? "O evento sai desta agenda e também do Google. " : ""}A exclusão fica guardada neste dispositivo e é enviada ao servidor assim que houver conexão.</p>
    </ConfirmDialog>
    </>
  );
}

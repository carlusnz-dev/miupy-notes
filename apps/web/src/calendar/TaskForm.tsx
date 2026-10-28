import { useId, useState, type FormEvent } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import TimeField from "../components/TimeField";
import type { TaskDraft, TaskOutput } from "../lib/calendar-api";
import Button from "../components/Button";

export type TaskFields = { title: string; description: string; dueDate: string; dueTime: string; completed: boolean };
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;

export const initialTaskFields = (task: TaskOutput | null, seed: Partial<TaskFields> = {}): TaskFields =>
  ({ title: task?.title ?? "", description: task?.description ?? "", dueDate: task?.dueDate ?? "", dueTime: task?.dueTime ?? "", completed: task?.status === "completed", ...seed });

/** Campos da tela no rascunho da API; devolve a mensagem de erro em vez de enviar dados inválidos. */
export function buildTaskDraft(fields: TaskFields): { draft: TaskDraft } | { error: string } {
  const title = fields.title.trim();
  if (!title) return { error: "Informe um título." };
  if (fields.dueTime && !fields.dueDate) return { error: "Informe a data para definir a hora." };
  if (fields.dueTime && !validTime.test(fields.dueTime)) return { error: "Informe um horário válido (hh:mm)." };
  return { draft: { title, description: fields.description, dueDate: fields.dueDate || null, dueTime: fields.dueDate && fields.dueTime ? fields.dueTime : null, status: fields.completed ? "completed" : "pending" } };
}

/** Formulário da tarefa sem moldura: usado dentro do Modal da edição e dentro do Modal de criação (aba "Tarefa"). */
export function TaskFormBody({ open, task, seed, onSubmit, onDelete, onClose, onBusyChange }: {
  open: boolean;
  task: TaskOutput | null;
  seed?: Partial<TaskFields>;
  onSubmit: (draft: TaskDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [fields, setFields] = useState<TaskFields>(() => initialTaskFields(task, seed));
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = { title: useId(), description: useId() };
  const set = <K extends keyof TaskFields>(key: K, value: TaskFields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange?.(value); };

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível concluir. Seus dados continuam no formulário.");
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildTaskDraft(fields);
    if ("error" in built) { setError(built.error); return; }
    void run(async () => { await onSubmit(built.draft); onClose(); });
  }

  return (
    <>
      <form className="calendar-form" onSubmit={submit} noValidate>
        <div className="calendar-field">
          <label htmlFor={ids.title}>Título</label>
          <input id={ids.title} data-autofocus value={fields.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required />
        </div>
        <div className="calendar-pair">
          <DatePicker label="Data (opcional)" value={fields.dueDate} onChange={(value) => { set("dueDate", value); if (!value) set("dueTime", ""); }} />
          <TimeField label="Hora (opcional)" value={fields.dueTime} onChange={(value) => set("dueTime", value)} disabled={!fields.dueDate} />
        </div>
        <div className="calendar-field">
          <label htmlFor={ids.description}>Descrição</label>
          <textarea id={ids.description} rows={3} value={fields.description} maxLength={8000} onChange={(e) => set("description", e.target.value)} />
        </div>
        {task && <label className="calendar-check"><input type="checkbox" checked={fields.completed} onChange={(e) => set("completed", e.target.checked)} /> Concluída</label>}
        {error && <p className="calendar-error" role="alert">{error}</p>}
        <div className="modal-actions">
          {task && onDelete && <Button variant="danger" className="calendar-delete" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Excluir</Button>}
          <Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Salvar"}</Button>
        </div>
        <p className="calendar-note">Tarefas são salvas direto no servidor e exigem conexão.</p>
      </form>
      {onDelete && (
        <ConfirmDialog open={open && confirmDelete} title="Excluir esta tarefa?" confirmLabel="Excluir tarefa" busyLabel="Excluindo…" busy={busy} error={confirmDelete ? error : null}
          onCancel={() => setConfirmDelete(false)} onConfirm={() => void run(async () => { await onDelete(); setConfirmDelete(false); onClose(); })}>
          <p>A tarefa é removida da agenda.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Edição de uma tarefa existente, no Modal compartilhado. */
export default function TaskForm({ open, task, onClose, onSubmit, onDelete }: {
  open: boolean;
  task: TaskOutput;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Editar tarefa" onClose={onClose} busy={busy} className="calendar-modal">
      <TaskFormBody open={open} task={task} onSubmit={onSubmit} onDelete={onDelete} onClose={onClose} onBusyChange={setBusy} />
    </Modal>
  );
}

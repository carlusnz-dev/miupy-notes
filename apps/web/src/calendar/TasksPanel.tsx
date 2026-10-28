import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import OverdueBeacon from "../components/OverdueBeacon";
import { usePresence } from "../components/popover-behavior";
import { fromIso } from "../lib/calendar-date";
import type { TaskOutput } from "../lib/calendar-api";
import { relativeDay } from "./format";

/** "Hoje, 18:00", "ter., 27 out" ou "Sem data". */
export function dueLabel(task: Pick<TaskOutput, "dueDate" | "dueTime">): string {
  const date = task.dueDate ? fromIso(task.dueDate) : null;
  if (!date) return "Sem data";
  return `${relativeDay(date)}${task.dueTime ? `, ${task.dueTime}` : ""}`;
}

/**
 * Resumo das tarefas pendentes (contagem e lista, com caixa para concluir) e o aviso vermelho das atrasadas.
 * A lista é um bloco que se abre sob o resumo; atrasadas ganham a cor de aviso também na lista.
 */
export default function TasksPanel({ pending, overdue, onToggle, onOpen, error, onDismissError }: {
  pending: TaskOutput[];
  overdue: TaskOutput[];
  onToggle: (task: TaskOutput) => void;
  onOpen: (task: TaskOutput) => void;
  error: string | null;
  onDismissError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const mounted = usePresence(open, list);
  const overdueIds = new Set(overdue.map((task) => task.id));
  const find = (id: string) => pending.find((task) => task.id === id);
  return (
    <section className="calendar-tasks" aria-label="Tarefas">
      <div className="calendar-tasks-head">
        <button type="button" className="calendar-tasks-toggle" aria-expanded={open} aria-controls={mounted ? listId : undefined} onClick={() => setOpen((value) => !value)}>
          <span>Tarefas pendentes: <strong>{pending.length}</strong></span>
          <ChevronDown size={14} aria-hidden="true" data-open={open || undefined} />
        </button>
        <OverdueBeacon
          items={overdue.map((task) => ({ id: task.id, title: task.title, when: `venceu ${dueLabel(task).toLocaleLowerCase("pt-BR")}` }))}
          onOpen={(id) => { const task = find(id); if (task) onOpen(task); }}
          onComplete={(id) => { const task = find(id); if (task) onToggle(task); }}
        />
      </div>
      {error && <p className="calendar-error" role="alert">{error} <button type="button" className="calendar-link-button" onClick={onDismissError}>Fechar</button></p>}
      {mounted && (
        <div ref={list} id={listId} className="calendar-tasks-list">
          {pending.length === 0 ? <p className="calendar-empty">Nenhuma tarefa pendente.</p> : (
            <ul>
              {pending.map((task) => (
                <li key={task.id} data-overdue={overdueIds.has(task.id) || undefined}>
                  <input type="checkbox" checked={false} onChange={() => onToggle(task)} aria-label={`Concluir tarefa: ${task.title}`} />
                  <button type="button" onClick={() => onOpen(task)}><span>{task.title}</span><small>{dueLabel(task)}{overdueIds.has(task.id) ? " · atrasada" : ""}</small></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

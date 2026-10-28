import type { TaskOutput } from "../lib/calendar-api";

/** Marcador compacto de tarefa (grade e mês): caixa de seleção para concluir e o título, que abre a edição. */
export default function TaskMarker({ task, overdue, onToggle, onOpen, style }: {
  task: TaskOutput;
  overdue: boolean;
  onToggle: (task: TaskOutput) => void;
  onOpen: (task: TaskOutput) => void;
  style?: React.CSSProperties;
}) {
  const done = task.status === "completed";
  return (
    <span className="calendar-task" data-done={done || undefined} data-overdue={overdue || undefined} style={style}>
      <input type="checkbox" checked={done} onChange={() => onToggle(task)} aria-label={`${done ? "Reabrir" : "Concluir"} tarefa: ${task.title}`} />
      <button type="button" className="calendar-task-title" onClick={() => onOpen(task)} title={`${task.title}${task.dueTime ? ` · ${task.dueTime}` : ""}${overdue ? " · atrasada" : ""}`}>
        {task.dueTime && <small>{task.dueTime}</small>}{task.title}
      </button>
    </span>
  );
}

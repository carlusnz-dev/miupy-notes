import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Button from "../components/Button";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import Select from "../components/Select";
import TimeField from "../components/TimeField";
import { saveHabit, type Habit } from "../lib/habits-api";
import { toIso, todayLocal } from "../lib/calendar-date";
import { buildHabitInput, firstInvalid, type HabitFormErrors, type HabitFormValues } from "./form";
import { kinds, priorities, recurrenceTypes, weekdayShort } from "./labels";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return <div className="habits-field"><label htmlFor={id}>{label}</label>{children}{error && <small id={`${id}-error`} className="habits-field-error">{error}</small>}</div>;
}

function initial(existing?: Habit): HabitFormValues {
  const recurrence = existing?.recurrence ?? { type: "daily" as const, every: 1 };
  return {
    title: existing?.title ?? "", description: existing?.description ?? "", kind: existing?.kind ?? "other", priority: existing?.priority ?? "medium",
    recurrence: recurrence.type, every: recurrence.type === "weekdays" ? "1" : String(recurrence.every), days: recurrence.type === "weekdays" ? recurrence.days : [],
    startDate: existing?.startDate ?? toIso(todayLocal()), endDate: existing?.endDate ?? "", time: existing?.time ?? "",
  };
}

export default function HabitForm({ existing, onClose, onSaved }: { existing?: Habit; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState(() => initial(existing));
  const [errors, setErrors] = useState<HabitFormErrors>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const uid = useId();
  const set = <K extends keyof HabitFormValues>(key: K, value: HabitFormValues[K]) => {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(({ [key as keyof HabitFormErrors]: _, ...rest }) => rest);
  };
  const toggleDay = (day: number) => set("days", values.days.includes(day) ? values.days.filter(item => item !== day) : [...values.days, day]);
  const invalid = (field: keyof HabitFormErrors) => ({ id: `${uid}-${field}`, "aria-invalid": errors[field] ? true : undefined, "aria-describedby": errors[field] ? `${uid}-${field}-error` : undefined });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildHabitInput(values);
    if ("errors" in built) {
      setErrors(built.errors); setError("");
      const first = firstInvalid(built.errors);
      if (first) event.currentTarget.querySelector<HTMLElement>(`[id='${uid}-${first}'], [data-field='${first}'] input, [data-field='${first}'] button`)?.focus();
      return;
    }
    setBusy(true); setError("");
    try { await saveHabit(built.input, existing); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar. Tente de novo."); queueMicrotask(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }

  return <Modal open title={existing ? "Editar hábito" : "Novo hábito"} onClose={onClose} busy={busy} className="habits-modal">
    <form className="habits-form" onSubmit={submit} autoComplete="off" noValidate>
      <fieldset disabled={busy}>
        <Field id={`${uid}-title`} label="Título" error={errors.title}><input data-autofocus maxLength={200} value={values.title} onChange={e => set("title", e.target.value)} {...invalid("title")} /></Field>
        <Field id={`${uid}-description`} label="Descrição (opcional)" error={errors.description}><textarea rows={2} maxLength={1000} value={values.description} onChange={e => set("description", e.target.value)} {...invalid("description")} /></Field>
        <div className="habits-form-grid">
          <Select label="Tipo" value={values.kind} options={kinds} onChange={value => set("kind", value)} />
          <Select label="Prioridade" value={values.priority} options={priorities} onChange={value => set("priority", value)} />
        </div>
        <Select label="Periodicidade" value={values.recurrence} options={recurrenceTypes} onChange={value => set("recurrence", value)} />
        {values.recurrence !== "weekdays"
          ? <Field id={`${uid}-every`} label={values.recurrence === "daily" ? "A cada quantos dias" : "A cada quantas semanas"} error={errors.every}><input type="number" inputMode="numeric" min={1} max={values.recurrence === "daily" ? 365 : 52} value={values.every} onChange={e => set("every", e.target.value)} {...invalid("every")} /></Field>
          : <div className="habits-field" data-field="days" role="group" aria-label="Dias da semana">
              <span className="habits-label">Dias da semana</span>
              <div className="habits-weekdays">{weekdayShort.map((name, day) => <button key={name} type="button" aria-pressed={values.days.includes(day)} onClick={() => toggleDay(day)}>{name}</button>)}</div>
              {errors.days && <small className="habits-field-error" role="alert">{errors.days}</small>}
            </div>}
        <div className="habits-form-grid">
          <div data-field="startDate" className="habits-field"><DatePicker label="Começa em" value={values.startDate} onChange={value => set("startDate", value)} />{errors.startDate && <small className="habits-field-error" role="alert">{errors.startDate}</small>}</div>
          <div data-field="endDate" className="habits-field"><DatePicker label="Termina em (opcional)" value={values.endDate} onChange={value => set("endDate", value)} />{errors.endDate && <small className="habits-field-error" role="alert">{errors.endDate}</small>}</div>
        </div>
        <div data-field="time" className="habits-field"><TimeField label="Horário (opcional)" value={values.time} onChange={value => set("time", value)} />{errors.time && <small className="habits-field-error" role="alert">{errors.time}</small>}</div>
      </fieldset>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="habits-error">{error}</p>}
      <footer><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar hábito"}</Button></footer>
    </form>
  </Modal>;
}

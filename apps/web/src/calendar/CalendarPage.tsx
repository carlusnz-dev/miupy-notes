import { useEffect, useMemo, useState } from "react";
import { signIn, useAuth, getOwnerId, getAuthSessionVersion, isCurrentAuthSession } from "../lib/auth";
import { connectGoogle, cancelGoogleConnection, disconnectGoogle, createCalendarEvent, createTask, deleteCalendarEvent, deleteTask, getCalendarEvent, getGoogleStatus, listEventsInRange, listTasks, reflectEvent, syncGoogle, unreflectEvent, updateCalendarEvent, updateTask } from "../lib/calendar-api";
import { listNotesMetadata } from "../lib/notes-api";
import { usePageTitle } from "../lib/use-page-title";
import CalendarWorkspace, { type GoogleApi } from "./CalendarWorkspace";
import type { NoteChoice } from "./EventForm";
import { createIndexedDbCalendarStore } from "./store";
import type { TasksApi } from "./tasks";
import type { RangeRemote } from "./use-calendar";

const MAX_NOTE_PAGES = 5;
async function loadNotes(): Promise<NoteChoice[]> {
  const notes: NoteChoice[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_NOTE_PAGES; page++) {
    const result = await listNotesMetadata({ cursor, limit: 100 });
    notes.push(...result.items.map((note) => ({ id: note.id, title: note.title })));
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return notes.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

const remote: RangeRemote = {
  create: createCalendarEvent,
  update: updateCalendarEvent,
  remove: deleteCalendarEvent,
  get: (id) => getCalendarEvent(id),
  listRange: (range, signal) => listEventsInRange(range, signal),
};
const tasksApi: TasksApi = { list: listTasks, create: createTask, update: updateTask, remove: deleteTask };
const google: GoogleApi = { connect: connectGoogle, cancelConnect: cancelGoogleConnection, disconnect: disconnectGoogle, getStatus: getGoogleStatus, sync: syncGoogle, reflect: reflectEvent, unreflect: unreflectEvent };

export default function CalendarPage() {
  usePageTitle("Agendas");
  const auth = useAuth();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const store = useMemo(() => createIndexedDbCalendarStore(), []);
  // A sessão que abriu a página: respostas de uma sessão encerrada não gravam nada.
  const session = useMemo(() => getAuthSessionVersion(), [auth.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (auth.status !== "signed-in") { setOwnerId(null); return; }
    let live = true;
    getOwnerId().then((id) => { if (live) setOwnerId(id); }).catch(() => { if (live) setOwnerId(null); });
    return () => { live = false; };
  }, [auth.status]);

  if (auth.status !== "signed-in") {
    return (
      <section className="calendar-page">
        <div className="eyebrow">TEMPO COM CONTEXTO</div>
        <h1>Agendas<em>.</em></h1>
        {auth.status === "checking" ? <p role="status">Verificando sua conta…</p>
          : auth.status === "unsupported" ? <p className="muted">Abra o aplicativo desktop para conectar sua conta Google e acessar suas agendas.</p>
          : <><p className="muted">Conecte sua conta para acessar seus eventos.</p><button type="button" className="button" onClick={() => void signIn()} disabled={auth.signingIn}>{auth.signingIn ? "Conectando…" : "Entrar com Google"}</button></>}
        {auth.error && <p role="alert">{auth.error}</p>}
      </section>
    );
  }
  if (!ownerId) return <section className="calendar-page"><p role="status">Preparando suas agendas…</p></section>;
  return <CalendarWorkspace key={ownerId} ownerId={ownerId} store={store} remote={remote} loadNotes={loadNotes} google={google} tasksApi={tasksApi} isCurrent={() => isCurrentAuthSession(session)} />;
}

import { isAuthConfigured } from "./api-client";
import { expireSession, getOwnerId, subscribeAuth } from "./auth";
import { createAutosaveQueue } from "./notes-autosave";
import { createIndexedDbDraftStore } from "./notes-draft-store-idb";
import { getNote, updateNote } from "./notes-api";
import { cacheSavedNote } from "./notes-queries";
import { createSessionBinding } from "./notes-session";
import { queryClient } from "./query-client";

const countFormat = new Intl.NumberFormat("pt-BR");

/**
 * Fila de gravação das notas da conta (ver `createAutosaveQueue`). Vive fora das telas: envia e reenvia depois
 * de a tela mudar de nota. Rascunhos não confirmados ficam no IndexedDB do WebView, separados por conta, sem
 * criptografia da aplicação (ver docs/decisoes/2026-10-20_autosave-duravel.md).
 */
export const notesSaver = createAutosaveQueue({
  update: updateNote,
  read: (id) => getNote(id),
  store: createIndexedDbDraftStore(),
  onSaved: (note) => cacheSavedNote(queryClient, note),
  onError: (error) => { if (error.code === "UNAUTHORIZED") expireSession(); },
  formatCount: countFormat.format,
});

// O provedor de token do cliente HTTP só existe com a sessão ativa; este módulo carrega com o editor
// (sob demanda), possivelmente depois do login, então `isAuthConfigured` diz o estado de partida.
const binding = createSessionBinding(notesSaver, getOwnerId, isAuthConfigured());
subscribeAuth((state) => { void binding.onAuthState(state); });
/** Espera a fila refletir o login atual (rascunhos da conta já restaurados). */
export const sessionIdle = binding.whenIdle;

/** Para o guard central de `signOut`: rascunhos não sincronizados da conta (ou leitura local com erro = desconhecido). */
export async function draftSignOutCheck(): Promise<{ unsynced: number; unknown: boolean }> {
  await binding.whenIdle();
  return { unsynced: notesSaver.unsyncedCount(), unknown: notesSaver.restoreError() !== null };
}

/** Resultado da limpeza dos rascunhos no último logout explícito. */
export const lastSignOutClose = binding.lastClose;
if (isAuthConfigured()) void binding.onAuthState({ status: "signed-in", error: null });

if (typeof window !== "undefined") {
  // Texto que nem o disco nem o servidor têm ainda: fechar a janela pede confirmação. Texto já gravado
  // localmente sobrevive ao fechamento e volta na próxima abertura.
  window.addEventListener("beforeunload", (event) => { if (notesSaver.hasUnprotected()) event.preventDefault(); });
  window.addEventListener("online", () => notesSaver.retryNow());
}

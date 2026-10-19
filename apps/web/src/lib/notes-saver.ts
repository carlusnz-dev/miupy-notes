import { subscribeAuth, expireSession } from "./auth";
import { createAutosaveQueue } from "./notes-autosave";
import { updateNote } from "./notes-api";
import { cacheSavedNote } from "./notes-queries";
import { queryClient } from "./query-client";

const countFormat = new Intl.NumberFormat("pt-BR");

/**
 * Fila de gravação das notas da sessão (ver `createAutosaveQueue`). Vive fora das telas para terminar PATCH
 * e reenviar texto pendente depois de a tela mudar de nota. Só em memória: notas são dados pessoais.
 */
export const notesSaver = createAutosaveQueue({
  update: updateNote,
  onSaved: (note) => cacheSavedNote(queryClient, note),
  onError: (error) => { if (error.code === "UNAUTHORIZED") expireSession(); },
  formatCount: countFormat.format,
});

// Sair da conta limpa tudo, como o cache de consultas. Sessão expirada (o app preenche `error`) mantém o texto
// pendente em memória: o usuário volta a entrar sem perder o que digitou.
subscribeAuth((state) => { if (state.status === "signed-out" && state.error === null) notesSaver.clear(); });

// Texto ainda não confirmado pelo servidor: fechar a janela pede confirmação.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => { if (notesSaver.hasUnsaved()) event.preventDefault(); });
}

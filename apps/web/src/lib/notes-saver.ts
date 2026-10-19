import { isAuthConfigured } from "./api-client";
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

// Sessão encerrada: sair da conta apaga tudo, como o cache de consultas; sessão expirada (o app preenche `error`)
// guarda o texto não gravado em memória, sem enviá-lo antes de o usuário voltar a pedir. Em ambos, respostas de
// PATCH em voo da sessão antiga são ignoradas (não repovoam o cache nem a base). Só a transição
// "logado → deslogado" conta: `signingIn` e outros ajustes de estado não mexem na fila.
// Este módulo carrega junto do editor (sob demanda), possivelmente depois do login: o provedor de token do
// cliente HTTP só existe enquanto a sessão está ativa, então diz o estado de partida.
let wasSignedIn = isAuthConfigured();
subscribeAuth((state) => {
  if (wasSignedIn && state.status === "signed-out") {
    if (state.error === null) notesSaver.clear();
    else notesSaver.endSession();
  }
  wasSignedIn = state.status === "signed-in";
});

// Texto ainda não confirmado pelo servidor: fechar a janela pede confirmação.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => { if (notesSaver.hasUnsaved()) event.preventDefault(); });
}

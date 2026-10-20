import type { EntryView } from "./notes-autosave";

export type SaveLabel = { text: string; alert: boolean };

/** Texto do indicador do editor: separa "protegido neste computador" de "sincronizado com a nuvem". */
export function describeSave(view: EntryView | undefined, savedAt: string): SaveLabel {
  if (!view) return { text: savedAt, alert: false };
  if (view.status === "saving") return { text: "Salvando na nuvem…", alert: false };
  if (view.status === "protecting") return { text: "Gravando no computador…", alert: false };
  if (view.status === "local-failed") {
    return view.localIssue === "cleanup"
      ? { text: "Sincronizado, mas o armazenamento local não pôde ser atualizado. Tentando de novo.", alert: true }
      : { text: "Falha ao proteger localmente: o texto só existe nesta janela e não será enviado até ser gravado.", alert: true };
  }
  if (view.status === "conflict") return { text: "Conflito: esta nota mudou em outro lugar.", alert: true };
  if (view.status === "paused") return { text: "Sessão expirada. Entre de novo para sincronizar; o texto está guardado neste computador.", alert: true };
  if (view.status === "offline") return { text: "Sem conexão. Alterações guardadas neste computador; nova tentativa em breve.", alert: true };
  if (view.status === "error") {
    const forbidden = view.error?.code === "FORBIDDEN";
    return { text: forbidden ? "Esta conta não tem acesso a esta API." : `Erro ao sincronizar: ${view.error?.message ?? "tente de novo."} Texto guardado neste computador.`, alert: true };
  }
  if (view.invalid) return { text: `${view.invalid} Guardado neste computador, não enviado.`, alert: true };
  if (view.status === "local") return { text: "Alterações locais pendentes", alert: false };
  return { text: savedAt, alert: false };
}

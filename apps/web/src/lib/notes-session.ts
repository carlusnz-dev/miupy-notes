import type { AuthState } from "./auth";
import type { AutosaveQueue, CloseResult } from "./notes-autosave";

/**
 * Liga o estado de autenticação à fila:
 * - entrar → `openSession(owner)`: restaura os rascunhos da conta (a mesma conta retoma; outra conta nunca vê os da primeira);
 * - sessão expirada (`error` preenchido) → `suspend`: guarda tudo e para de enviar;
 * - sair por escolha (`error` nulo) → `closeSession`, apagando os rascunhos da conta.
 * Só a transição "logado → deslogado" conta: `signingIn` e outros ajustes de estado não mexem na fila.
 *
 * A geração (`epoch`) muda assim que o estado chega, antes de qualquer await: um login que ainda lê o dono não
 * abre sessão se a saída já aconteceu, e a fila é suspensa/fechada na hora.
 */
export function createSessionBinding(queue: AutosaveQueue, getOwnerId: () => Promise<string | null>, wasSignedIn = false) {
  let signedIn = wasSignedIn;
  /** Há sessão da fila aberta (ou abrindo) para o login atual. */
  let active = false;
  let epoch = 0;
  let idle: Promise<unknown> = Promise.resolve();
  let lastClose: CloseResult = { purged: true };
  return {
    onAuthState(state: Pick<AuthState, "status" | "error">): Promise<void> {
      // A notificação duplicada também pode chegar enquanto o único opener ainda lê o dono.
      if (state.status === "signed-in" && active) return idle.then(() => undefined, () => undefined);
      const mine = ++epoch;
      const was = signedIn;
      signedIn = state.status === "signed-in";
      const previous = idle;
      if (!signedIn) active = false;
      let work: Promise<unknown>;
      if (signedIn) {
        active = true;
        work = (async () => {
          const owner = await getOwnerId().catch(() => null);
          await previous.catch(() => undefined);
          if (mine !== epoch || !owner) { if (mine === epoch) active = false; return; }
          await queue.openSession(owner);
        })();
      } else if (!was && !active) {
        work = Promise.resolve();
      } else if (state.error === null) {
        work = queue.closeSession({ purge: true }).then((result) => { lastClose = result; }, (error) => { lastClose = { purged: false, error }; });
      } else {
        queue.suspend();
        work = Promise.resolve();
      }
      idle = work;
      return work.then(() => undefined, () => undefined);
    },
    /** Termina quando a última mudança de autenticação já foi aplicada à fila (inclui a restauração dos rascunhos). */
    whenIdle: () => idle.then(() => undefined, () => undefined),
    /** Resultado do último logout explícito (limpeza dos rascunhos locais). */
    lastClose: () => lastClose,
  };
}

/** Decisão do guard central de logout: pede confirmação com rascunhos não sincronizados (ou sem poder verificá-los). */
export function signOutNeedsConfirmation(check: { unsynced: number; unknown: boolean } | null, discardDrafts: boolean): boolean {
  if (discardDrafts) return false;
  return check === null || check.unknown || check.unsynced > 0;
}

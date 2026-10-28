import { useRef, useState } from "react";
import Modal from "./Modal";
import { signOut, type SignOutResult } from "../lib/auth";
import Button from "./Button";

const purgeWarning = "Você saiu, mas os rascunhos locais não puderam ser apagados deste computador. A limpeza será tentada no próximo login enquanto o app continuar aberto. Se você fechar o app antes, eles poderão reaparecer ao entrar nesta conta. Eles não aparecem para outras contas.";

/**
 * Sair da conta. O guard está em `signOut` (lib/auth.ts): com notas não sincronizadas ele devolve
 * `needs-confirmation` e este botão pergunta antes de repetir com `discardDrafts`.
 */
export default function SignOutButton({ disabled = false }: { disabled?: boolean }) {
  const [pending, setPending] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function finish(result: SignOutResult) {
    if (result.status === "signed-out" && result.cleanupErrors.length) window.alert(result.cleanupErrors.join(" ") + (!result.draftsPurged ? " " + purgeWarning : ""));
  }

  async function request() {
    const result = await signOut();
    if (result.status === "needs-confirmation") { setPending(result.unsynced); setOpen(true); return; }
    finish(result);
  }

  async function discard() {
    setOpen(false);
    finish(await signOut({ discardDrafts: true }));
  }

  return (
    <>
      <Button type="button" onClick={() => void request()} disabled={disabled}>Sair</Button>
      <Modal open={open} title="Sair com alterações não sincronizadas?" onClose={() => setOpen(false)} initialFocusRef={cancelRef}>
        <p>
          {pending === null ? "Não foi possível verificar se há alterações de notas ou eventos ainda não enviadas." : pending === 1 ? "Uma alteração ainda não chegou à nuvem." : `${pending} alterações ainda não chegaram à nuvem.`}
          {" "}Sair apaga os rascunhos de notas e os envios pendentes da agenda desta conta.
        </p>
        <div className="modal-actions">
          <Button ref={cancelRef} type="button" onClick={() => setOpen(false)}>Continuar logado</Button>
          <Button variant="primary" type="button" onClick={() => void discard()}>Sair e descartar</Button>
        </div>
      </Modal>
    </>
  );
}

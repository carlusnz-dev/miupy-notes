import type { ReactNode } from 'react';
import SharedModal from '../components/Modal';

// Mantém a API antiga (title/children/busy/onClose) sobre o Modal compartilhado, que cuida de foco, Esc, backdrop e GSAP.
// Quem usa monta/desmonta o componente (`{aberto && <Modal …/>}`): a entrada anima, a saída é imediata; para fade de saída, usar o Modal compartilhado com `open` controlado.
export function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  return <SharedModal open title={title} onClose={onClose} busy={busy} className="finance-modal">{children}</SharedModal>;
}

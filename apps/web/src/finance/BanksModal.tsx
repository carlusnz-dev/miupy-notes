import { useState, type FormEvent } from 'react';
import { saveBank, type Bank, type BankInput } from '../lib/finance-api';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import { Modal } from './Modal';
export function logoSource(logo: Bank['logo']) { return !logo ? undefined : logo.kind === 'url' ? logo.url : `data:${logo.mime};base64,${logo.base64}`; }
export function BanksModal({ bank, onClose, onChanged }: { bank?: Bank; onClose: () => void; onChanged: () => void }) {
  const editing = bank;
  const [logo, setLogo] = useState<Bank['logo']>(bank?.logo ?? null);
  const [kind, setKind] = useState<'none' | 'url' | 'upload'>(bank?.logo?.kind ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setLogo(null); setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 65_536) { setError('Use PNG, JPEG ou WebP de até 64 KiB.'); return; }
    setFileBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('Falha ao ler imagem.')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
      });
      setLogo({ kind: 'upload', mime: file.type as 'image/png' | 'image/jpeg' | 'image/webp', base64 });
    } catch { setError('Não foi possível ler o arquivo.'); }
    finally { setFileBusy(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
    const input: BankInput = { title: String(data.get('title')), logo: kind === 'none' ? null : kind === 'url' ? { kind: 'url', url: String(data.get('url')) } : logo };
    if (kind === 'upload' && !logo) { setError('Selecione um arquivo válido.'); return; }
    setBusy(true); setError('');
    try { await saveBank(input, editing); onChanged(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Falha ao salvar banco.'); }
    finally { setBusy(false); }
  }
  return <Modal title={editing ? 'Editar banco' : 'Novo banco'} onClose={onClose} busy={busy || fileBusy}>
    <form className="finance-form" onSubmit={submit} key={editing?.id ?? 'new'}><fieldset disabled={busy || fileBusy}>
      <Input label="Título" autoFocus data-autofocus name="title" defaultValue={editing?.title} maxLength={120} required error={error || undefined} />
      <Select label="Logo" value={kind} options={[{ value: 'none', label: 'Sem logo' }, { value: 'url', label: 'URL de imagem' }, { value: 'upload', label: 'Enviar arquivo' }]} onChange={next => { setKind(next); setLogo(null); }} />
      {kind === 'url' && <Input label="URL HTTP(S) de PNG, JPEG ou WebP" name="url" type="url" maxLength={2048} defaultValue={editing?.logo?.kind === 'url' ? editing.logo.url : ''} required />}
      {kind === 'upload' && <label>Imagem PNG, JPEG ou WebP (até 64 KiB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} />{logo?.kind === 'upload' && <span>Arquivo pronto para salvar.</span>}</label>}
    </fieldset><footer><Button disabled={busy || fileBusy} onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={fileBusy} type="submit">Salvar banco</Button></footer></form>
  </Modal>;
}

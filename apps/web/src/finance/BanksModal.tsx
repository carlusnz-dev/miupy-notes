import { useState, type FormEvent } from 'react';
import { saveBank, deleteBank, type Bank, type BankInput } from '../lib/finance-api';
import Select from '../components/Select';
import { Modal } from './Modal';
export function logoSource(logo: Bank['logo']) { return !logo ? undefined : logo.kind === 'url' ? logo.url : `data:${logo.mime};base64,${logo.base64}`; }
export function BanksModal({ banks, onClose, onChanged }: { banks: Bank[]; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<Bank>();
  const [logo, setLogo] = useState<Bank['logo']>(null);
  const [kind, setKind] = useState<'none' | 'url' | 'upload'>('none');
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
    try { await saveBank(input, editing); form.reset(); setEditing(undefined); setKind('none'); setLogo(null); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Falha ao salvar banco.'); }
    finally { setBusy(false); }
  }
  async function remove(bank: Bank) {
    setBusy(true); setError('');
    try { await deleteBank(bank.id, bank.version); if (editing?.id === bank.id) setEditing(undefined); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Falha ao excluir.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Bancos" onClose={onClose} busy={busy || fileBusy}>
    <ul className="finance-banks">{banks.map(bank => <li key={bank.id}>{bank.logo && <img src={logoSource(bank.logo)} alt="" referrerPolicy="no-referrer" />}<span>{bank.title}</span><button disabled={busy || fileBusy} onClick={() => { setEditing(bank); setLogo(bank.logo); setKind(bank.logo?.kind ?? 'none'); setError(''); }}>Editar <span className="finance-sr">{bank.title}</span></button><button disabled={busy || fileBusy} onClick={() => void remove(bank)}>Excluir <span className="finance-sr">{bank.title}</span></button></li>)}</ul>
    {!banks.length && <p>Nenhum banco cadastrado.</p>}
    <form className="finance-form" onSubmit={submit} key={editing?.id ?? 'new'}><h3>{editing ? 'Editar banco' : 'Novo banco'}</h3><fieldset disabled={busy || fileBusy}>
      <label>Título<input autoFocus data-autofocus name="title" defaultValue={editing?.title} maxLength={120} required /></label>
      <Select label="Logo" value={kind} options={[{ value: 'none', label: 'Sem logo' }, { value: 'url', label: 'URL de imagem' }, { value: 'upload', label: 'Enviar arquivo' }]} onChange={next => { setKind(next); setLogo(null); }} />
      {kind === 'url' && <label>URL HTTP(S) de PNG, JPEG ou WebP<input name="url" type="url" maxLength={2048} defaultValue={editing?.logo?.kind === 'url' ? editing.logo.url : ''} required /></label>}
      {kind === 'upload' && <label>Imagem PNG, JPEG ou WebP (até 64 KiB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} />{logo?.kind === 'upload' && <span>Arquivo pronto para salvar.</span>}</label>}
    </fieldset>{error && <p role="alert">{error}</p>}<footer>{editing && <button type="button" disabled={busy || fileBusy} onClick={() => { setEditing(undefined); setKind('none'); setLogo(null); }}>Novo banco</button>}<button disabled={busy || fileBusy} type="submit">{busy ? 'Salvando…' : 'Salvar banco'}</button></footer></form>
    <p className="finance-muted">Excluir um banco mantém seu nome histórico nos lançamentos existentes.</p>
  </Modal>;
}

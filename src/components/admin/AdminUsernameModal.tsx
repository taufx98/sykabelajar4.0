import { useEffect, useState } from 'react';
import { AtSign, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';

export function AdminUsernameModal({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: (username: string) => void;
}) {
  const [value, setValue] = useState(`@${user?.username || ''}`);
  const [reason, setReason] = useState('Perubahan username melalui Panel Admin');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setValue(`@${user?.username || ''}`);
    setMessage(null);
  }, [user?.id, user?.username]);

  const normalize = (input: string) => input.replace(/^@+/, '').trim().toLowerCase();

  const friendlyError = (raw = '') => ({
    ACCESS_DENIED: 'Akses admin ditolak.',
    USER_NOT_FOUND: 'Pengguna tidak ditemukan.',
    USERNAME_REQUIRED: 'Username wajib diisi.',
    USERNAME_LENGTH_INVALID: 'Username harus 3–30 karakter.',
    USERNAME_FORMAT_INVALID: 'Username hanya boleh berisi huruf kecil, angka, titik, garis bawah, atau strip.',
    USERNAME_TAKEN: 'Username tersebut sudah digunakan pengguna lain.',
  } as Record<string, string>)[raw] || raw || 'Gagal mengubah username.';

  const save = async () => {
    const next = normalize(value);
    if (next.length < 3 || next.length > 30) {
      setMessage({ type: 'error', text: 'Username harus 3–30 karakter.' });
      return;
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(next)) {
      setMessage({ type: 'error', text: 'Gunakan hanya huruf kecil, angka, titik, garis bawah, atau strip.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('admin_change_username', {
        p_user_id: user.id,
        p_username: next,
        p_reason: reason.trim() || 'Perubahan username melalui Panel Admin',
      });
      if (error) throw error;
      const username = Array.isArray(data) ? data[0]?.username : data?.username;
      onSaved(username || next);
      setValue(`@${username || next}`);
      setMessage({ type: 'success', text: `Username berhasil diubah menjadi @${username || next}.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: friendlyError(error?.message) });
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[140] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ganti username">
    <button className="absolute inset-0 bg-black/70" onClick={() => !saving && onClose()} aria-label="Tutup" />
    <div className="relative w-full max-w-lg rounded-2xl surface-card-bg border surface-border shadow-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Avatar name={user.full_name || user.username || 'U'} id={user.id} size={50} src={user.avatar_url || undefined} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-fg truncate">{user.full_name || user.username}</p>
          <p className="text-xs text-fg-muted">Username saat ini: <b>@{user.username || '—'}</b></p>
        </div>
        <button onClick={() => !saving && onClose()} aria-label="Tutup"><X size={18}/></button>
      </div>
      <label className="block"><span className="text-xs text-fg-muted">Username baru</span><div className="relative mt-1"><AtSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input autoFocus className="input pl-9" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} placeholder="@usernamebaru" maxLength={31}/></div><span className="text-[10px] text-fg-muted mt-1 block">3–30 karakter · huruf kecil, angka, titik, _ atau -</span></label>
      <label className="block"><span className="text-xs text-fg-muted">Alasan audit</span><input className="input mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={160}/></label>
      {message && <div className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${message.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-red-500/20 bg-red-500/5 text-red-200'}`}>{message.type === 'success' && <Check size={15}/>}<span>{message.text}</span></div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan Username'}</Button></div>
    </div>
  </div>;
}

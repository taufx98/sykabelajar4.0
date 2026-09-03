import { useEffect, useMemo, useState } from 'react';
import { AtSign, Check, Search, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const normalize = (value: string) => value.replace(/^@+/, '').trim().toLowerCase();

function friendlyError(message: string) {
  const map: Record<string, string> = {
    ACCESS_DENIED: 'Akses admin ditolak.',
    USER_NOT_FOUND: 'Pengguna tidak ditemukan.',
    USERNAME_REQUIRED: 'Username wajib diisi.',
    USERNAME_LENGTH_INVALID: 'Username harus 3–30 karakter.',
    USERNAME_FORMAT_INVALID: 'Username hanya boleh berisi huruf kecil, angka, titik, garis bawah, atau strip.',
    USERNAME_TAKEN: 'Username tersebut sudah digunakan pengguna lain.',
  };
  return map[message] || message || 'Gagal mengubah username.';
}

export function AdminUsernameShortcut() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('Perubahan username melalui Panel Admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('id,username,full_name,institution,avatar_url,status,account_type,created_at').order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      setMessage({ type: 'error', text: friendlyError(error?.message) });
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadUsers(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter(u => `${u.full_name || ''} ${u.username || ''} ${u.institution || ''}`.toLowerCase().includes(q));
  }, [users, search]);

  const openEditor = (user: any) => {
    setSelected(user);
    setValue(`@${user.username || ''}`);
    setMessage(null);
  };

  const save = async () => {
    if (!selected) return;
    const next = normalize(value);
    if (next.length < 3 || next.length > 30) return setMessage({ type: 'error', text: 'Username harus 3–30 karakter.' });
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(next)) return setMessage({ type: 'error', text: 'Gunakan hanya huruf kecil, angka, titik, garis bawah, atau strip.' });
    setSaving(true); setMessage(null);
    try {
      const { data, error } = await supabase.rpc('admin_change_username', { p_user_id: selected.id, p_username: next, p_reason: reason.trim() || 'Perubahan username melalui Panel Admin' });
      if (error) throw error;
      const updated = Array.isArray(data) ? data[0] : data;
      setUsers(rows => rows.map(row => row.id === selected.id ? { ...row, username: updated?.username || next } : row));
      setSelected((row: any) => row ? { ...row, username: updated?.username || next } : row);
      setValue(`@${updated?.username || next}`);
      setMessage({ type: 'success', text: `Username berhasil diubah menjadi @${updated?.username || next}.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: friendlyError(error?.message) });
    } finally { setSaving(false); }
  };

  return <Card className="p-4 md:p-5 space-y-4">
    <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-moss-500/10 flex items-center justify-center shrink-0"><AtSign size={18} className="text-accent"/></div><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-fg">Ganti Username</h3><p className="text-[11px] text-fg-muted mt-1">Admin dapat mengganti username akun sendiri maupun pengguna lain. Perubahan dicatat ke audit log dan username selalu dinormalisasi tanpa karakter @ di database.</p></div></div>
    <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama, username, atau institusi…"/></div>
    <div className="max-h-[48vh] overflow-y-auto space-y-1.5 pr-1">{loading ? <p className="p-6 text-center text-sm text-fg-muted">Memuat pengguna…</p> : filtered.length === 0 ? <p className="p-6 text-center text-sm text-fg-muted">Tidak ada pengguna yang cocok.</p> : filtered.map(user => <button key={user.id} type="button" onClick={() => openEditor(user)} className="w-full flex items-center gap-3 p-3 rounded-xl text-left border border-transparent hover:surface-elevated hover:surface-border transition"><Avatar name={user.full_name || user.username || 'U'} id={user.id} size={42} src={user.avatar_url || undefined}/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg truncate">{user.full_name || user.username}</p><p className="text-[11px] text-fg-muted truncate">@{user.username || '—'} · {user.institution || '—'}</p></div><Badge color={user.status === 'BANNED' ? 'err' : 'default'}>{user.account_type || 'user'}</Badge><span className="text-fg-muted">›</span></button>)}</div>

    {selected && <div className="fixed inset-0 z-[140] flex items-center justify-center p-4"><button className="absolute inset-0 bg-black/70" onClick={() => !saving && setSelected(null)} aria-label="Tutup"/><div className="relative w-full max-w-lg rounded-2xl surface-card-bg border surface-border shadow-2xl p-5 space-y-4"><div className="flex items-start gap-3"><Avatar name={selected.full_name || selected.username || 'U'} id={selected.id} size={50} src={selected.avatar_url || undefined}/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{selected.full_name || selected.username}</p><p className="text-xs text-fg-muted">Username saat ini: <b>@{selected.username || '—'}</b></p></div><button onClick={() => !saving && setSelected(null)} aria-label="Tutup"><X size={18}/></button></div><label className="block"><span className="text-xs text-fg-muted">Username baru</span><div className="relative mt-1"><AtSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input autoFocus className="input pl-9" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} placeholder="@usernamebaru" maxLength={31}/></div><span className="text-[10px] text-fg-muted mt-1 block">3–30 karakter · huruf kecil, angka, titik, _ atau -</span></label><label className="block"><span className="text-xs text-fg-muted">Alasan audit</span><input className="input mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={160}/></label>{message && <div className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${message.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-red-500/20 bg-red-500/5 text-red-200'}`}>{message.type === 'success' ? <Check size={15}/> : <UserRound size={15}/>}<span>{message.text}</span></div>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => !saving && setSelected(null)} disabled={saving}>Batal</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan Username'}</Button></div></div></div>}
  </Card>;
}

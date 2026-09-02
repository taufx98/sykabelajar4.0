import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ShieldCheck, Search, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { adminSetUserRole, getUserRoles, type BackendRole } from '@/services/role.service';
import { supabase } from '@/lib/supabase';

type AdminUser = { id: string; username: string | null; full_name: string | null; institution: string | null; avatar_url: string | null; roles: BackendRole[] };
const ROLE_OPTIONS: BackendRole[] = ['student', 'teacher', 'organizer_member', 'admin'];
const ROLE_LABEL: Record<BackendRole, string> = { student: 'Pelajar', teacher: 'Guru', organizer_member: 'Penyelenggara', admin: 'Admin' };

export function AdminRolesPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,username,full_name,institution,avatar_url').order('created_at', { ascending: true });
      if (profileError) throw profileError;
      const rows = await Promise.all((profiles ?? []).map(async (profile) => ({ ...profile, roles: await getUserRoles(profile.id) })));
      setUsers(rows as AdminUser[]);
    } catch (err: any) {
      console.error('[SykaBelajar] admin users load failed', err);
      setError(err?.message ?? 'Gagal memuat pengguna.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => users.filter((u) => `${u.full_name ?? ''} ${u.username ?? ''} ${u.institution ?? ''}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const saveRole = async (userId: string, role: BackendRole) => {
    setSaving(userId); setError('');
    try {
      const current = users.find((u) => u.id === userId);
      if (!current) return;
      await Promise.all(ROLE_OPTIONS.map(async (candidate) => {
        const active = candidate === role;
        if (active || current.roles.includes(candidate)) await adminSetUserRole(userId, candidate, active, `Admin role update: ${role}`);
      }));
      await load();
    } catch (err: any) {
      console.error('[SykaBelajar] admin role update failed', err);
      setError(err?.message ?? 'Gagal mengubah role.');
    } finally { setSaving(null); }
  };

  return <div className="min-h-screen p-4 space-y-4">
    <div className="flex items-center gap-3"><Link to="/admin"><button className="w-9 h-9 rounded-xl surface-elevated flex items-center justify-center text-fg-secondary"><ArrowLeft size={18} /></button></Link><div><h1 className="font-display font-bold text-xl text-fg">Manajemen Role</h1><p className="text-xs text-slate-500">Hanya admin backend yang dapat mengubah role pengguna.</p></div><Badge color="moss">Admin</Badge></div>
    <Card className="p-4"><div className="flex items-center gap-2 mb-4"><ShieldCheck size={18} className="text-accent" /><p className="text-sm text-fg-secondary">Perubahan disimpan langsung ke <code>user_roles</code> melalui RPC backend.</p></div><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, username, sekolah..." /></div></Card>
    {error && <Card className="p-4 border-red-500/30"><p className="text-sm text-red-300">{error}</p></Card>}
    <div className="space-y-2">
      {loading ? <Card className="p-8 text-center text-sm text-slate-500">Memuat pengguna…</Card> : filtered.map((u) => { const activeRole = u.roles.includes('admin') ? 'admin' : u.roles.includes('organizer_member') ? 'organizer_member' : u.roles.includes('teacher') ? 'teacher' : 'student'; return <Card key={u.id} className="p-3"><div className="flex flex-col md:flex-row md:items-center gap-3"><Avatar name={u.full_name ?? u.username ?? 'U'} id={u.id} size={40} src={u.avatar_url ?? undefined} /><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{u.full_name || u.username || 'Pengguna'}</p><p className="text-xs text-slate-500 truncate">@{u.username || '—'} · {u.institution || '—'}</p></div><select className="input md:w-48" value={activeRole} onChange={(e) => { void saveRole(u.id, e.target.value as BackendRole); }} disabled={saving === u.id}>{ROLE_OPTIONS.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select>{saving === u.id && <span className="text-xs text-slate-500 flex items-center gap-1"><Save size={13} /> Menyimpan…</span>}</div></Card>; })}
      {!loading && !filtered.length && <Card className="p-8 text-center text-sm text-slate-500">Pengguna tidak ditemukan.</Card>}
    </div>
  </div>;
}

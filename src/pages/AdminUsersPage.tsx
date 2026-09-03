import { useEffect, useMemo, useState } from 'react';
import { AtSign, Ban, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { AdminUsernameModal } from '@/components/admin/AdminUsernameModal';
import { banUser } from '@/services/adminCore.service';

export function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [usernameEditor, setUsernameEditor] = useState<any | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('id,username,full_name,institution,avatar_url,status,account_type,created_at').order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void loadUsers();
    const channel = supabase.channel('admin-users-live').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void loadUsers()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter(user => !query || `${user.full_name || ''} ${user.username || ''} ${user.institution || ''}`.toLowerCase().includes(query));
  }, [users, search]);

  const onBan = async (id: string) => {
    if (!confirm('Ban user ini?')) return;
    setBusy(true);
    try { await banUser(id); await loadUsers(); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3">
    <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama, username, atau institusi..."/></div>
    <Card className="overflow-hidden p-0">
      <div className="divide-y surface-border">
        {loading ? <p className="p-8 text-center text-sm text-fg-muted">Memuat pengguna…</p> : filteredUsers.length === 0 ? <p className="p-8 text-center text-sm text-fg-muted">Pengguna tidak ditemukan.</p> : filteredUsers.map(user => <div key={user.id} className="group flex items-center gap-3 p-3 md:p-4 hover:surface-elevated transition">
          <Avatar name={user.full_name || user.username || 'U'} id={user.id} size={40} src={user.avatar_url || undefined}/>
          <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{user.full_name || user.username || 'Tanpa nama'}</p><p className="text-[11px] text-slate-500 truncate">@{user.username || '—'} · {user.institution || '—'}</p></div>
          <Badge color={user.status === 'BANNED' ? 'err' : 'default'}>{user.account_type || 'user'}</Badge>
          <div className="flex items-center gap-1.5 shrink-0"><Button size="sm" variant="outline" onClick={() => setUsernameEditor(user)} aria-label={`Ganti username ${user.full_name || user.username}`} icon={<AtSign size={14}/>}>Ganti Username</Button><Button size="sm" variant="danger" onClick={() => void onBan(user.id)} disabled={busy} icon={<Ban size={14}/>}>Ban</Button></div>
        </div>)}
      </div>
    </Card>
    {usernameEditor && <AdminUsernameModal user={usernameEditor} onClose={() => setUsernameEditor(null)} onSaved={username => { setUsers(rows => rows.map(row => row.id === usernameEditor.id ? { ...row, username } : row)); setUsernameEditor(null); }} />}
  </div>;
}

import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { ArrowLeft, Users, UserPlus, Shield, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';

export function OrganizerMembersPage() {
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data: ownerOrg, error: orgError } = await supabase.from('organizers').select('id,name').eq('owner_user_id', auth.user.id).maybeSingle();
    if (orgError) throw orgError;
    if (!ownerOrg) return;
    setOrg(ownerOrg);
    const { data: memberRows, error } = await supabase.from('organizer_members').select('*').eq('organizer_id', ownerOrg.id).order('created_at');
    if (error) throw error;
    setMembers(memberRows ?? []);
    const ids = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);
    if (!ids.length) return;
    const { data: ps } = await supabase.from('public_profiles').select('id,username,full_name,institution,avatar_url').in('id', ids);
    setProfiles(Object.fromEntries((ps ?? []).map((p: any) => [p.id, p])));
  };

  useEffect(() => { void load(); }, []);

  const addMember = async () => {
    if (!org || !username.trim()) return;
    setBusy(true);
    try {
      const { data: target, error: targetError } = await supabase.from('profiles').select('id,username').eq('username', username.trim()).maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error('Username tidak ditemukan.');
      const { error } = await supabase.from('organizer_members').upsert({ organizer_id: org.id, user_id: target.id, role, status: 'ACTIVE' }, { onConflict: 'organizer_id,user_id' });
      if (error) throw error;
      setUsername('');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (id: string, status: 'ACTIVE' | 'SUSPENDED') => {
    setBusy(true);
    try {
      const { error } = await supabase.from('organizer_members').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const removeMember = async (id: string) => {
    if (!confirm('Hapus member ini dari organisasi?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('organizer_members').delete().eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!org) return <div className="p-6"><Card className="p-8 text-center text-slate-500">Organisasi belum ditemukan.</Card></div>;
  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-6xl mx-auto"><Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5"><ArrowLeft size={14}/> Kembali</Link><div className="flex items-center justify-between mb-6"><div><p className="text-xs text-moss-400">ORGANIZER CONTROL</p><h1 className="text-2xl font-bold text-fg">Manajemen Member</h1><p className="text-sm text-slate-500 mt-1">{org.name} · akses dikelola dari organizer_members.</p></div><Badge color="moss"><Users size={14}/> {members.length}</Badge></div>
    <Card className="p-4 mb-5"><div className="flex flex-col md:flex-row gap-2"><input className="input flex-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username pengguna"/><select className="input md:w-44" value={role} onChange={(e) => setRole(e.target.value)}><option value="owner">Owner</option><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select><Button loading={busy} onClick={() => void addMember()} icon={<UserPlus size={14}/>}>Tambah Member</Button></div></Card>
    <div className="space-y-2">{members.map((m) => { const p = profiles[m.user_id]; return <Card key={m.id} className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg overflow-hidden bg-moss-500/10">{p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" alt=""/> : <div className="h-full flex items-center justify-center font-bold text-moss-300">{String(p?.full_name || p?.username || '?').slice(0,1).toUpperCase()}</div>}</div><div className="flex-1"><p className="font-semibold text-fg">{p?.full_name || p?.username || m.user_id.slice(0,8)}</p><p className="text-xs text-slate-500">@{p?.username || '—'} · {p?.institution || '—'}</p></div><select className="input w-36" value={m.role} disabled={busy} onChange={async (e) => { setBusy(true); try { const { error } = await supabase.from('organizer_members').update({ role: e.target.value }).eq('id', m.id); if (error) throw error; await load(); } catch (err: any) { toast.error(err.message); } finally { setBusy(false); } }}><option value="owner">Owner</option><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select><Badge color={m.status === 'ACTIVE' ? 'moss' : 'default'}>{m.status}</Badge><button disabled={busy} onClick={() => void updateStatus(m.id, m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')} className="p-2 rounded-lg hover:bg-surface-elevated/50"><Shield size={16}/></button><button disabled={busy} onClick={() => void removeMember(m.id)} className="p-2 text-red-400 rounded-lg hover:bg-red-500/10"><Trash2 size={16}/></button></Card>; })}{!members.length && <Card className="p-8 text-center text-slate-500">Belum ada member tambahan.</Card>}</div>
  </div></div>;
}

import { toast } from '@/lib/toast';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, Users, Check, X, Key, Plus, Trash2, Shield, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { UserPicker, type PickedUser } from '@/components/ui/UserPicker';

interface Organizer {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  status: string;
  access_code: string | null;
  created_at: string;
  _members?: any[];
  _competitionCount?: number;
  _ownerProfile?: { username: string; full_name: string; avatar_url: string | null } | null;
  _memberProfiles?: Record<string, { username: string; full_name: string; avatar_url: string | null } | null>;
}

export function AdminOrganizersPage() {
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState('');
  const [pendingUsers, setPendingUsers] = useState<Record<string, PickedUser[]>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data: orgs, error } = await supabase.from('organizers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const enriched = await Promise.all((orgs || []).map(async (org) => {
        const [membersRes, compRes, ownerRes] = await Promise.all([
          supabase.from('organizer_members').select('*').eq('organizer_id', org.id),
          supabase.from('competitions').select('id', { count: 'exact', head: true }).eq('organizer_id', org.id),
          supabase.from('profiles').select('username,full_name,avatar_url').eq('id', org.owner_user_id).maybeSingle(),
        ]);
        const memberUserIds = (membersRes.data || []).map((m: any) => m.user_id).filter(Boolean);
        const memberProfilesMap: Record<string, { username: string; full_name: string; avatar_url: string | null } | null> = {};
        if (memberUserIds.length) {
          const { data: memberProfiles } = await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id', memberUserIds);
          for (const p of memberProfiles || []) memberProfilesMap[p.id] = { username: p.username, full_name: p.full_name, avatar_url: p.avatar_url };
        }
        return { ...org, _members: membersRes.data || [], _competitionCount: compRes.count || 0, _ownerProfile: ownerRes.data || null, _memberProfiles: memberProfilesMap };
      }));
      setOrganizers(enriched);
    } catch (e: any) {
      console.error('[Admin] organizers load failed', e);
      toast.warning(e?.message ?? 'Terjadi kesalahan saat memuat organisasi.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const filtered = organizers.filter(o => o.name.toLowerCase().includes(search.toLowerCase()) || o.slug?.toLowerCase().includes(search.toLowerCase()));

  const toggleStatus = async (org: Organizer, newStatus: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('organizers').update({ status: newStatus }).eq('id', org.id);
      if (error) throw error;
      toast.success(`Status diubah ke ${newStatus}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal update status');
    } finally { setBusy(false); }
  };

  const setAccessCode = async (orgId: string, code: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('organizers').update({ access_code: code }).eq('id', orgId);
      if (error) throw error;
      toast.success('Access code berhasil diatur');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal set access code');
    } finally { setBusy(false); }
  };

  const addMembers = async (orgId: string) => {
    const users = pendingUsers[orgId] || [];
    if (!users.length) return;
    setBusy(true);
    let added = 0;
    let skipped = 0;
    try {
      for (const u of users) {
        const { error } = await supabase.from('organizer_members').insert({ organizer_id: orgId, user_id: u.id, role: 'editor' });
        if (error) {
          if (error.message?.includes('duplicate')) { skipped++; continue; }
          throw error;
        }
        added++;
      }
      if (skipped > 0) toast.warning(`${added} ditambahkan, ${skipped} sudah ada (duplikat).`);
      else if (added > 0) toast.success(`${added} anggota berhasil ditambahkan!`);
      setPendingUsers(prev => ({ ...prev, [orgId]: [] }));
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menambah anggota');
    } finally { setBusy(false); }
  };

  const removeMember = async (memberId: string) => {
    if (!confirm('Hapus member ini?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('organizer_members').delete().eq('id', memberId);
      if (error) throw error;
      toast.success('Member dihapus');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menghapus member');
    } finally { setBusy(false); }
  };

  const statusColor = (s: string) => s === 'ACTIVE' ? 'moss' : s === 'SUSPENDED' ? 'err' : 'default';
  const getExcludedIds = (org: Organizer): string[] => [org.owner_user_id, ...(org._members || []).map((m: any) => m.user_id)];

  return (
    <div className="min-h-screen surface-bg p-5 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Link to="/admin" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg mb-5"><ArrowLeft size={14} /> Kembali ke Admin</Link>
        <div className="flex items-center justify-between mb-6"><div><p className="text-xs text-accent font-semibold uppercase">Admin</p><h1 className="text-2xl font-bold text-fg">Kelola Organisasi</h1><p className="text-sm text-fg-muted mt-1">Konfirmasi, settings, dan manajemen member</p></div><Badge color="moss"><Building2 size={14} /> {organizers.length} Organisasi</Badge></div>
        <div className="relative mb-4"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><input className="input pl-10" placeholder="Cari nama atau slug organisasi..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        {loading ? <Card className="p-8 text-center text-fg-muted">Memuat organisasi...</Card> : filtered.length === 0 ? <Card className="p-8 text-center text-fg-muted">Tidak ada organisasi ditemukan.</Card> : <div className="space-y-3">{filtered.map(org => <Card key={org.id}>
          <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-accent-muted/5 transition" onClick={() => setExpandedId(expandedId === org.id ? null : org.id)}><div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center shrink-0"><Building2 size={18} className="text-accent" /></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{org.name}</p><p className="text-[11px] text-fg-muted">/{org.slug} · {org._members?.length || 0} members · {org._competitionCount || 0} lomba</p></div><Badge color={statusColor(org.status) as any}>{org.status}</Badge><Badge>{org.access_code ? `🔑 ${org.access_code}` : '🔑 —'}</Badge>{expandedId === org.id ? <ChevronUp size={16} className="text-fg-muted" /> : <ChevronDown size={16} className="text-fg-muted" />}</div>
          {expandedId === org.id && <div className="border-t surface-border p-4 space-y-4 animate-slide-down relative">
            <div className="flex flex-wrap gap-2"><Button size="sm" variant={org.status === 'ACTIVE' ? 'primary' : 'outline'} onClick={() => void toggleStatus(org, 'ACTIVE')} disabled={busy} icon={<Check size={14} />}>Aktifkan</Button><Button size="sm" variant={org.status === 'SUSPENDED' ? 'danger' : 'outline'} onClick={() => void toggleStatus(org, 'SUSPENDED')} disabled={busy} icon={<X size={14} />}>Suspend</Button></div>
            <div><p className="text-xs font-semibold text-fg mb-2 flex items-center gap-1.5"><Key size={12} /> Access Code (Password)</p><div className="flex gap-2"><input className="input flex-1" placeholder={org.access_code || 'Belum diatur'} value={newAccessCode} onChange={e => setNewAccessCode(e.target.value)} /><Button size="sm" onClick={() => { void setAccessCode(org.id, newAccessCode); setNewAccessCode(''); }} disabled={busy || !newAccessCode.trim()}>Set</Button><Button size="sm" variant="outline" onClick={() => void setAccessCode(org.id, '0')} disabled={busy}>Reset ke 0</Button></div></div>
            <div><p className="text-xs font-semibold text-fg mb-2 flex items-center gap-1.5"><Users size={12} /> Members</p><div className="space-y-1.5 mb-3"><div className="flex items-center gap-2 p-2 rounded-lg surface-elevated"><Shield size={12} className="text-amber-400" /><span className="text-xs text-fg flex-1">Owner: {org._ownerProfile ? `${org._ownerProfile.full_name || org._ownerProfile.username} | @${org._ownerProfile.username}` : org.owner_user_id.slice(0, 8) + '...'}</span><Badge color="moss">owner</Badge></div>{(org._members || []).map((m: any) => { const mp = org._memberProfiles?.[m.user_id]; const displayName = mp ? `${mp.full_name || mp.username}` : m.user_id.slice(0, 8) + '...'; const displayUsername = mp?.username || ''; return <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg surface-elevated">{mp ? <div className="w-6 h-6 rounded-full bg-gradient-to-br from-moss-400 to-moss-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">{String(displayName).slice(0, 1).toUpperCase()}</div> : <Users size={12} className="text-fg-muted" />}<span className="text-xs text-fg flex-1 truncate">{displayName}{displayUsername && <span className="text-fg-muted ml-1">@{displayUsername}</span>}</span><Badge>{m.role}</Badge><button className="text-red-400 hover:text-red-300 p-1" onClick={() => void removeMember(m.id)} disabled={busy}><Trash2 size={12} /></button></div>; })}</div><UserPicker excludedUserIds={getExcludedIds(org)} selected={pendingUsers[org.id] || []} onSelectionChange={users => setPendingUsers(prev => ({ ...prev, [org.id]: users }))} onAdd={() => void addMembers(org.id)} disabled={busy} placeholder="Cari nama atau username untuk ditambahkan..." /></div>
            <div className="text-[11px] text-fg-muted flex gap-4"><span>ID: {org.id.slice(0, 8)}...</span><span>Dibuat: {new Date(org.created_at).toLocaleDateString('id-ID')}</span></div>
          </div>}
        </Card>)}</div>}
      </div>
    </div>
  );
}

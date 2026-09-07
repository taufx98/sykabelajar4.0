import { toast } from '@/lib/toast';
import { useEffect, useState } from 'react';
import { Building2, Users, Check, X, Key, Plus, Trash2, Shield, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { UserPicker, type PickedUser } from '@/components/ui/UserPicker';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

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
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

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
      toast.success(newStatus === 'ACTIVE' ? 'Organisasi diaktifkan.' : 'Organisasi disuspend.');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal memperbarui status organisasi.');
    } finally { setBusy(false); }
  };

  const setAccessCode = async (orgId: string, code: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('organizers').update({ access_code: code }).eq('id', orgId);
      if (error) throw error;
      toast.success('Kode akses berhasil diperbarui.');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal memperbarui kode akses.');
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
      if (skipped > 0) toast.warning(`${added} anggota ditambahkan, ${skipped} sudah terdaftar.`);
      else if (added > 0) toast.success(`${added} anggota berhasil ditambahkan.`);
      setPendingUsers(prev => ({ ...prev, [orgId]: [] }));
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menambah anggota.');
    } finally { setBusy(false); }
  };

  const removeMember = async (memberId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('organizer_members').delete().eq('id', memberId);
      if (error) throw error;
      toast.success('Anggota berhasil dihapus.');
      setRemoveTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menghapus anggota.');
    } finally { setBusy(false); }
  };

  const removeMemberName = removeTarget ? organizers.flatMap((org) => org._members || []).find((member: any) => member.id === removeTarget)?.user_id : null;
  const statusColor = (s: string) => s === 'ACTIVE' ? 'moss' : s === 'SUSPENDED' ? 'err' : 'default';
  const statusLabel = (s: string) => s === 'ACTIVE' ? 'Aktif' : s === 'SUSPENDED' ? 'Ditangguhkan' : 'Menunggu';
  const getExcludedIds = (org: Organizer): string[] => [org.owner_user_id, ...(org._members || []).map((m: any) => m.user_id)];

  return (
    <div className="min-h-screen surface-bg p-4 md:p-7">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="flex flex-col gap-4 border-b surface-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Organisasi</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg md:text-3xl">Kelola organisasi</h1>
            <p className="mt-1.5 text-sm leading-6 text-fg-muted">Kelola status organisasi, kode akses, dan anggota dalam satu tempat.</p>
          </div>
          <Badge color="moss"><Building2 size={14} /> {organizers.length} organisasi</Badge>
        </section>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input pl-10" placeholder="Cari nama atau slug organisasi..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? <Card className="p-8 text-center text-fg-muted">Memuat organisasi...</Card> : filtered.length === 0 ? <Card className="p-8 text-center text-fg-muted">Tidak ada organisasi ditemukan.</Card> : <div className="space-y-3">{filtered.map(org => <Card key={org.id}>
          <button type="button" className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent-muted/5 transition" onClick={() => setExpandedId(expandedId === org.id ? null : org.id)} aria-expanded={expandedId === org.id}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-muted"><Building2 size={18} className="text-accent" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{org.name}</p><p className="text-[11px] text-fg-muted">/{org.slug} · {org._members?.length || 0} anggota · {org._competitionCount || 0} lomba</p></div>
            <Badge color={statusColor(org.status) as any}>{statusLabel(org.status)}</Badge>
            <Badge>{org.access_code ? `🔑 ${org.access_code}` : '🔑 Belum diatur'}</Badge>
            {expandedId === org.id ? <ChevronUp size={16} className="text-fg-muted" /> : <ChevronDown size={16} className="text-fg-muted" />}
          </button>
          {expandedId === org.id && <div className="relative space-y-4 border-t surface-border p-4 animate-slide-down">
            <div className="flex flex-wrap gap-2"><Button size="sm" variant={org.status === 'ACTIVE' ? 'primary' : 'outline'} onClick={() => void toggleStatus(org, 'ACTIVE')} disabled={busy} icon={<Check size={14} />}>Aktifkan</Button><Button size="sm" variant={org.status === 'SUSPENDED' ? 'danger' : 'outline'} onClick={() => void toggleStatus(org, 'SUSPENDED')} disabled={busy} icon={<X size={14} />}>Tangguhkan</Button></div>
            <div><p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg"><Key size={12} /> Kode akses organisasi</p><div className="flex gap-2"><input className="input flex-1" placeholder={org.access_code || 'Belum diatur'} value={newAccessCode} onChange={e => setNewAccessCode(e.target.value)} /><Button size="sm" onClick={() => { void setAccessCode(org.id, newAccessCode); setNewAccessCode(''); }} disabled={busy || !newAccessCode.trim()}>Simpan</Button><Button size="sm" variant="outline" onClick={() => void setAccessCode(org.id, '0')} disabled={busy}>Reset</Button></div></div>
            <div><p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg"><Users size={12} /> Anggota</p><div className="mb-3 space-y-1.5"><div className="flex items-center gap-2 rounded-lg surface-elevated p-2"><Shield size={12} className="text-amber-400" /><span className="flex-1 text-xs text-fg">Pemilik: {org._ownerProfile ? `${org._ownerProfile.full_name || org._ownerProfile.username} · @${org._ownerProfile.username}` : 'Tidak tersedia'}</span><Badge color="moss">Pemilik</Badge></div>{(org._members || []).map((m: any) => { const mp = org._memberProfiles?.[m.user_id]; const displayName = mp ? `${mp.full_name || mp.username}` : 'Anggota'; const displayUsername = mp?.username || ''; return <div key={m.id} className="flex items-center gap-2 rounded-lg surface-elevated p-2">{mp ? <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">{String(displayName).slice(0, 1).toUpperCase()}</div> : <Users size={12} className="text-fg-muted" />}<span className="flex-1 truncate text-xs text-fg">{displayName}{displayUsername && <span className="ml-1 text-fg-muted">@{displayUsername}</span>}</span><Badge>{m.role === 'editor' ? 'Editor' : 'Anggota'}</Badge><button type="button" aria-label={`Hapus ${displayName}`} className="p-1 text-red-400 hover:text-red-300" onClick={() => setRemoveTarget(m.id)} disabled={busy}><Trash2 size={12} /></button></div>; })}</div><UserPicker excludedUserIds={getExcludedIds(org)} selected={pendingUsers[org.id] || []} onSelectionChange={users => setPendingUsers(prev => ({ ...prev, [org.id]: users }))} onAdd={() => void addMembers(org.id)} disabled={busy} placeholder="Cari nama atau username untuk ditambahkan..." /></div>
          </div>}
        </Card>)}</div>}
      </div>
      <ConfirmModal open={!!removeTarget} title="Hapus anggota?" description={removeMemberName ? 'Anggota ini akan dihapus dari organisasi dan tidak lagi memiliki akses ke organisasi tersebut.' : 'Anggota ini akan dihapus dari organisasi.'} confirmLabel="Hapus anggota" cancelLabel="Batal" tone="danger" busy={busy} onCancel={() => setRemoveTarget(null)} onConfirm={() => { if (removeTarget) void removeMember(removeTarget); }} />
    </div>
  );
}

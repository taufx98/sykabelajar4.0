import { toast } from "@/lib/toast";
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Users, UserPlus, Shield, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';

const ROLE_OPTIONS = ['owner', 'editor', 'reviewer', 'finance', 'viewer'] as const;
type OrganizerRole = typeof ROLE_OPTIONS[number];

type MemberRow = {
  organizer_id: string;
  user_id: string;
  role: OrganizerRole | string;
  member_role?: string;
  status: 'ACTIVE' | 'SUSPENDED' | string;
  is_active?: boolean;
};

export function OrganizerMembersPage() {
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<OrganizerRole>('editor');
  const [busy, setBusy] = useState(false);

  const currentRole = useMemo<OrganizerRole>(() => {
    const value = String(org?._memberRole || 'viewer');
    return (ROLE_OPTIONS as readonly string[]).includes(value) ? value as OrganizerRole : 'viewer';
  }, [org]);

  const canManageMembers = currentRole === 'owner';

  const load = async () => {
    const orgResult = await resolveCurrentUserOrganizer();
    if (!orgResult) return;
    setOrg(orgResult);

    const { data: memberRows, error } = await supabase
      .from('organizer_members')
      .select('*')
      .eq('organizer_id', orgResult.id)
      .order('created_at');
    if (error) throw error;
    setMembers((memberRows ?? []) as MemberRow[]);

    const ids = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);
    if (!ids.length) {
      setProfiles({});
      return;
    }

    const { data: ps, error: profileError } = await supabase
      .from('public_profiles')
      .select('id,username,full_name,institution,avatar_url')
      .in('id', ids);
    if (profileError) throw profileError;
    setProfiles(Object.fromEntries((ps ?? []).map((p: any) => [p.id, p])));
  };

  useEffect(() => { void load().catch((e) => toast.error(e?.message ?? 'Gagal memuat member.')); }, []);

  const addMember = async () => {
    if (!canManageMembers || !org || !username.trim()) return;
    setBusy(true);
    try {
      const { data: target, error: targetError } = await supabase
        .from('profiles')
        .select('id,username')
        .eq('username', username.trim())
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error('Username tidak ditemukan.');

      const { error } = await supabase.from('organizer_members').upsert(
        {
          organizer_id: org.id,
          user_id: target.id,
          role,
          member_role: role,
          status: 'ACTIVE',
          is_active: true,
        },
        { onConflict: 'organizer_id,user_id' },
      );
      if (error) throw error;
      setUsername('');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menambahkan member.');
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (member: MemberRow, nextRole: OrganizerRole) => {
    if (!canManageMembers || member.user_id === org?.owner_user_id || member.role === 'owner') return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('organizer_members')
        .update({ role: nextRole, member_role: nextRole, updated_at: new Date().toISOString() })
        .eq('organizer_id', member.organizer_id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal mengubah role.');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (member: MemberRow, status: 'ACTIVE' | 'SUSPENDED') => {
    if (!canManageMembers || member.role === 'owner') return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('organizer_members')
        .update({ status, is_active: status === 'ACTIVE', updated_at: new Date().toISOString() })
        .eq('organizer_id', member.organizer_id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal mengubah status member.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: MemberRow) => {
    if (!canManageMembers || member.role === 'owner') return;
    if (!confirm('Hapus member ini dari organisasi?')) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('organizer_members')
        .delete()
        .eq('organizer_id', member.organizer_id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menghapus member.');
    } finally {
      setBusy(false);
    }
  };

  if (!org) {
    return <div className="p-6"><Card className="p-8 text-center text-slate-500">Organisasi belum ditemukan.</Card></div>;
  }

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5"><ArrowLeft size={14}/> Kembali</Link>
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-accent">ORGANIZER CONTROL</p>
            <h1 className="text-2xl font-bold text-fg">Manajemen Member</h1>
            <p className="text-sm text-slate-500 mt-1">{org.name} · akses dikelola oleh role organisasi.</p>
          </div>
          <Badge color="moss"><Users size={14}/> {members.length}</Badge>
        </div>

        {canManageMembers ? (
          <Card className="p-4 mb-5">
            <div className="flex flex-col md:flex-row gap-2">
              <input className="input flex-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username pengguna"/>
              <select className="input md:w-44" value={role} onChange={(e) => setRole(e.target.value as OrganizerRole)}>
                <option value="editor">Editor</option>
                <option value="reviewer">Reviewer</option>
                <option value="finance">Finance</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button loading={busy} disabled={!username.trim()} onClick={() => void addMember()} icon={<UserPlus size={14}/>}>Tambah Member</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-4 mb-5 text-sm text-slate-500">Role <strong className="text-fg">{currentRole}</strong> hanya dapat melihat anggota. Hubungi Owner untuk perubahan akses.</Card>
        )}

        <div className="space-y-2">
          {members.map((member) => {
            const p = profiles[member.user_id];
            const isOwner = member.role === 'owner';
            return (
              <Card key={`${member.organizer_id}:${member.user_id}`} className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-moss-500/10 shrink-0">
                  {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" alt=""/> : <div className="h-full flex items-center justify-center font-bold text-accent">{String(p?.full_name || p?.username || '?').slice(0,1).toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-fg truncate">{p?.full_name || p?.username || member.user_id.slice(0,8)}</p>
                  <p className="text-xs text-slate-500 truncate">@{p?.username || '—'} · {p?.institution || '—'}</p>
                </div>
                {canManageMembers ? (
                  <select
                    className="input w-36"
                    value={String(member.role || member.member_role || 'viewer')}
                    disabled={busy || isOwner}
                    onChange={(e) => void updateRole(member, e.target.value as OrganizerRole)}
                  >
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="finance">Finance</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <Badge color="default">{member.role || member.member_role || 'viewer'}</Badge>
                )}
                <Badge color={member.status === 'ACTIVE' ? 'moss' : 'default'}>{member.status}</Badge>
                {canManageMembers && !isOwner && (
                  <>
                    <button disabled={busy} onClick={() => void updateStatus(member, member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')} title={member.status === 'ACTIVE' ? 'Suspend member' : 'Aktifkan member'} className="p-2 rounded-lg hover:bg-surface-elevated/50"><Shield size={16}/></button>
                    <button disabled={busy} onClick={() => void removeMember(member)} title="Hapus member" className="p-2 text-red-400 rounded-lg hover:bg-red-500/10"><Trash2 size={16}/></button>
                  </>
                )}
              </Card>
            );
          })}
          {!members.length && <Card className="p-8 text-center text-slate-500">Belum ada member tambahan.</Card>}
        </div>
      </div>
    </div>
  );
}

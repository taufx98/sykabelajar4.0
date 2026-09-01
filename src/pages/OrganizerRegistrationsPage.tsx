import { toast } from '@/lib/toast';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, X, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { listOrganizerRegistrations, reviewRegistration } from '@/services/organizer.service';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';

const statusLabel: Record<string, string> = { PENDING: 'Menunggu review', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' };

export function OrganizerRegistrationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const org = await resolveCurrentUserOrganizer();
      if (!org) throw new Error('Workspace penyelenggara tidak ditemukan.');
      const registrations = await listOrganizerRegistrations(org.id);
      setRows(registrations);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat pendaftar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    let reason = '';
    if (status === 'REJECTED') {
      reason = window.prompt('Alasan penolakan:', 'Bukti/ketentuan pendaftaran belum sesuai.')?.trim() || '';
      if (!reason) return;
    }
    setBusy(id);
    try {
      await reviewRegistration(id, status, reason);
      toast.success(status === 'APPROVED' ? 'Pendaftar disetujui.' : 'Pendaftar ditolak.');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memperbarui pendaftar.');
    } finally {
      setBusy(null);
    }
  };

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
    <div className="max-w-6xl mx-auto">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg mb-5"><ArrowLeft size={14}/> Kembali</Link>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6"><div><p className="text-xs text-accent">PENDAFTAR LIVE</p><h1 className="text-2xl font-bold text-fg">Review Pendaftar</h1><p className="text-sm text-fg-muted mt-1">Data peserta diambil langsung dari workspace aktif.</p></div><Badge color="moss"><Users size={14}/> {rows.length.toLocaleString('id-ID')}</Badge></div>
      {loading && <Card className="p-8 text-center text-fg-muted">Memuat pendaftar…</Card>}
      {!loading && !rows.length && <Card className="p-10 text-center text-fg-muted">Belum ada pendaftar.</Card>}
      {!loading && rows.length > 0 && <div className="space-y-3">{rows.map((r) => <Card key={r.registration_id || r.id} className="p-4"><div className="flex flex-col md:flex-row md:items-center gap-4"><div className="w-11 h-11 rounded-xl bg-accent/10 overflow-hidden shrink-0">{r.avatar_url ? <img src={r.avatar_url} className="w-full h-full object-cover" alt=""/> : <div className="w-full h-full flex items-center justify-center text-accent font-bold">{String(r.full_name || r.username || 'P').slice(0,1).toUpperCase()}</div>}</div><div className="flex-1 min-w-0"><p className="font-semibold text-fg truncate">{r.full_name || 'Pengguna'}</p><p className="text-xs text-accent truncate">@{r.username || 'unknown'}</p><p className="text-xs text-fg-muted truncate">{r.institution || '—'}{r.competition_title ? ` · ${r.competition_title}` : ''}</p><p className="text-[11px] text-fg-muted mt-1">{new Date(r.submitted_at || r.created_at).toLocaleString('id-ID')}</p>{r.social_proof_url && <a href={r.social_proof_url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Lihat bukti posting</a>}</div><Badge>{statusLabel[r.status] || r.status}</Badge>{r.status === 'PENDING' && <div className="flex gap-2"><Button size="sm" loading={busy===r.registration_id} onClick={()=>void review(r.registration_id,'APPROVED')} icon={<Check size={14}/>}>Setujui</Button><Button size="sm" variant="outline" disabled={busy===r.registration_id} onClick={()=>void review(r.registration_id,'REJECTED')} icon={<X size={14}/>}>Tolak</Button></div>}</div></Card>)}</div>}
    </div>
  </div>;
}

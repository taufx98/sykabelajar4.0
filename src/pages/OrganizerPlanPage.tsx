import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Gauge, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import { getActiveOrganizerEntitlements, type OrganizerEntitlement } from '@/services/organizerEntitlement.service';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';

const CAPABILITY_LABELS: Record<string, string> = {
  competition_create: 'Batas Buat Lomba',
  competition_publish: 'Publikasi Lomba',
  question_bank: 'Bank Soal',
  question_create: 'Jumlah Soal',
  essay_ai_assessment: 'AI Assessment Esai',
  twibbon_canvas: 'Twibbon Canvas',
  qr_serial: 'QR / Serial',
  certificate: 'Sertifikat',
  certificate_create: 'Jumlah Sertifikat',
  storage: 'Kapasitas Penyimpanan',
  participants: 'Kapasitas Peserta',
  member_limit: 'Batas Anggota',
};

function labelFor(capability?: string | null) {
  return CAPABILITY_LABELS[capability ?? ''] ?? (String(capability ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase()) || 'Fitur');
}

export function OrganizerPlanPage() {
  const [plan, setPlan] = useState<string | null>(null);
  const [items, setItems] = useState<OrganizerEntitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const org = await resolveCurrentUserOrganizer();
        if (!org) throw new Error('Organisasi tidak ditemukan.');
        const result = await getActiveOrganizerEntitlements(org.id);
        if (active) {
          setPlan(result.planCode);
          setItems(result.entitlements);
        }
      } catch (e: any) {
        if (active) {
          const message = e?.message ?? 'Gagal memuat plan.';
          setError(message);
          toast.error(message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
    <div className="max-w-5xl mx-auto">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg mb-5"><ArrowLeft size={14}/> Kembali ke Penyelenggara</Link>
      <div className="mb-6"><p className="text-xs text-accent font-semibold">PENYELENGGARA · PLAN</p><h1 className="font-display text-2xl font-bold text-fg">Plan & Usage</h1><p className="text-sm text-fg-muted mt-1">Fitur dan batas penggunaan yang aktif untuk workspace ini.</p></div>
      {error && <Card className="p-4 border-yellow-500/20 bg-yellow-500/5 text-yellow-200 mb-4">{error}</Card>}
      {loading ? <Card className="p-8 text-center text-fg-muted">Memuat penggunaan…</Card> : <>
        <Card className="p-5 mb-4"><div className="flex items-center gap-3"><ShieldCheck className="text-accent"/><div className="flex-1"><p className="text-xs text-fg-muted">Plan aktif</p><p className="text-xl font-bold text-fg">{plan ?? 'Belum ada plan aktif'}</p></div><Badge color={plan?'moss':'default'}>{plan?'DIGUNAKAN':'TIDAK AKTIF'}</Badge></div></Card>
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map((item) => <Card key={item.capability} className="p-4"><div className="flex items-start gap-3"><Gauge size={17} className="text-accent mt-0.5"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg">{labelFor(item.capability)}</p><p className="text-xs text-fg-muted mt-1">{item.limit_value == null ? 'Tanpa batas numerik' : `Maksimal ${Number(item.limit_value).toLocaleString('id-ID')}`}</p>{Object.keys(item.config ?? {}).length > 0 && <p className="text-[11px] text-fg-muted mt-2">Pengaturan tambahan aktif</p>}</div><CheckCircle2 size={15} className="text-accent"/></div></Card>)}
          {!items.length && <Card className="p-8 text-center text-fg-muted sm:col-span-2">Belum ada fitur aktif pada plan ini.</Card>}
        </div>
      </>}
    </div>
  </div>;
}

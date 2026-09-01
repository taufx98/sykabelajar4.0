import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Gauge, ShieldCheck, Sparkles, MessageCircle, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import {
  getActiveOrganizerEntitlements,
  type OrganizerEntitlement,
} from '@/services/organizerEntitlement.service';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';
import {
  listActiveOrganizerPlans,
  createOrganizerPlanOrderV2,
  requestCustomOrganizerPlan,
  type OrganizerPlanCatalogRow,
} from '@/services/commerce.service';

const CAPABILITY_LABELS: Record<string, string> = {
  competition_create: 'Batas Buat Lomba',
  competition_publish: 'Publikasi Lomba',
  question_bank: 'Bank Soal',
  question_create: 'Jumlah Soal',
  essay_ai_assessment: 'AI Assessment Esai',
  twibbon_canvas: 'Twibbon Canvas',
  twibbon: 'Twibbon',
  qr_serial: 'QR / Serial',
  certificate: 'Sertifikat',
  certificate_create: 'Jumlah Sertifikat',
  analytics: 'Analytics',
  advanced_reports: 'Laporan Lanjutan',
  bulk_notification: 'Notifikasi Massal',
  custom_branding: 'Custom Branding',
  storage: 'Kapasitas Penyimpanan',
  participants: 'Kapasitas Peserta',
  participant_limit: 'Batas Peserta',
  member_limit: 'Batas Anggota',
};

const CUSTOM_OPTIONS = [
  ['competition_create', 'Buat & kelola lomba'],
  ['participant_limit', 'Kapasitas peserta khusus'],
  ['question_bank', 'Bank soal'],
  ['question_create', 'Jumlah soal khusus'],
  ['certificate', 'Sertifikat'],
  ['analytics', 'Analytics'],
  ['advanced_reports', 'Laporan lanjutan'],
  ['bulk_notification', 'Notifikasi massal'],
  ['essay_ai_assessment', 'AI Assessment Esai'],
  ['custom_branding', 'Custom Branding'],
  ['twibbon', 'Twibbon'],
  ['twibbon_canvas', 'Twibbon Canvas'],
  ['qr_serial', 'QR / Serial'],
  ['member_limit', 'Batas anggota khusus'],
] as const;

function labelFor(capability?: string | null) {
  return CAPABILITY_LABELS[capability ?? ''] ?? (String(capability ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase()) || 'Fitur');
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value);
}

export function OrganizerPlanPage() {
  const [plan, setPlan] = useState<string | null>(null);
  const [items, setItems] = useState<OrganizerEntitlement[]>([]);
  const [catalog, setCatalog] = useState<OrganizerPlanCatalogRow[]>([]);
  const [billing, setBilling] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [selectedPlan, setSelectedPlan] = useState<string>('PREMIUM');
  const [whatsapp, setWhatsapp] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [customFeatures, setCustomFeatures] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState('');
  const [customWhatsapp, setCustomWhatsapp] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedCatalogPlan = useMemo(() => catalog.find((row) => row.plan_code === selectedPlan) ?? null, [catalog, selectedPlan]);
  const selectedPrice = selectedCatalogPlan ? (billing === 'MONTHLY' ? selectedCatalogPlan.monthly_price : selectedCatalogPlan.yearly_price) : 0;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const org = await resolveCurrentUserOrganizer();
        if (!org) throw new Error('Organisasi tidak ditemukan.');
        const [entitlementResult, planCatalog] = await Promise.all([
          getActiveOrganizerEntitlements(org.id),
          listActiveOrganizerPlans(),
        ]);
        if (!active) return;
        setPlan(entitlementResult.planCode);
        setItems(entitlementResult.entitlements);
        setCatalog(planCatalog);
        if (planCatalog[0]) setSelectedPlan(planCatalog[0].plan_code);
      } catch (e: unknown) {
        if (active) {
          const message = e instanceof Error ? e.message : 'Gagal memuat plan.';
          setError(message);
          toast.error(message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const submitUpgrade = async () => {
    setSubmitting(true);
    try {
      const org = await resolveCurrentUserOrganizer();
      if (!org) throw new Error('Organisasi tidak ditemukan.');
      if (!selectedCatalogPlan) throw new Error('Plan belum tersedia.');
      await createOrganizerPlanOrderV2({
        organizerId: org.id,
        planCode: selectedCatalogPlan.plan_code,
        billingPeriod: billing,
        whatsapp,
        proofUrl,
      });
      toast.success('Pesanan upgrade berhasil dikirim. Admin akan memverifikasi pembayaran.');
      setProofUrl('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat pesanan upgrade.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCustom = async () => {
    setCustomSubmitting(true);
    try {
      const org = await resolveCurrentUserOrganizer();
      if (!org) throw new Error('Organisasi tidak ditemukan.');
      await requestCustomOrganizerPlan({
        organizerId: org.id,
        requestedFeatures: customFeatures,
        notes: customNotes,
        contactWhatsapp: customWhatsapp,
      });
      toast.success('Permintaan custom berhasil dikirim ke admin.');
      setCustomNotes('');
      setCustomFeatures([]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengirim permintaan custom.');
    } finally {
      setCustomSubmitting(false);
    }
  };

  const toggleCustom = (value: string) => {
    setCustomFeatures((current) => current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);
  };

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg mb-5"><ArrowLeft size={14}/> Kembali ke Penyelenggara</Link>

        <div className="mb-6">
          <p className="text-xs text-accent font-semibold">PENYELENGGARA · PLAN</p>
          <h1 className="font-display text-2xl font-bold text-fg">Plan & Usage</h1>
          <p className="text-sm text-fg-muted mt-1">Kelola kapasitas dan fitur workspace berdasarkan plan yang aktif.</p>
        </div>

        {error && <Card className="p-4 border-yellow-500/20 bg-yellow-500/5 text-yellow-200 mb-4">{error}</Card>}

        {loading ? <Card className="p-8 text-center text-fg-muted">Memuat plan…</Card> : <>
          <Card className="p-5 mb-5">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <ShieldCheck className="text-accent" size={26}/>
              <div className="flex-1"><p className="text-xs text-fg-muted">Plan aktif</p><p className="text-xl font-bold text-fg">{plan ?? 'Belum ada plan aktif'}</p></div>
              <Badge color={plan ? 'moss' : 'default'}>{plan ? 'AKTIF' : 'TIDAK AKTIF'}</Badge>
            </div>
          </Card>

          <section className="mb-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
              <div><h2 className="text-lg font-bold text-fg">Upgrade plan</h2><p className="text-sm text-fg-muted">Pilih billing bulanan atau tahunan. Harga berasal dari katalog plan.</p></div>
              <div className="inline-flex rounded-xl border border-surface-border overflow-hidden self-start">
                <button type="button" onClick={() => setBilling('MONTHLY')} className={`px-4 py-2 text-sm ${billing === 'MONTHLY' ? 'bg-surface-elevated text-fg' : 'text-fg-muted'}`}>Bulanan</button>
                <button type="button" onClick={() => setBilling('YEARLY')} className={`px-4 py-2 text-sm ${billing === 'YEARLY' ? 'bg-surface-elevated text-fg' : 'text-fg-muted'}`}>Tahunan</button>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {catalog.map((row) => {
                const price = billing === 'MONTHLY' ? row.monthly_price : row.yearly_price;
                const active = selectedPlan === row.plan_code;
                return <button type="button" key={row.plan_code} onClick={() => setSelectedPlan(row.plan_code)} className={`text-left rounded-2xl border p-5 transition ${active ? 'border-accent bg-accent/5' : 'border-surface-border hover:bg-surface-elevated/30'}`}>
                  <div className="flex items-center justify-between gap-3 mb-2"><div><p className="text-lg font-bold text-fg">{row.name}</p><p className="text-xs text-fg-muted uppercase tracking-wide">{row.plan_code}</p></div>{active && <Badge color="moss">Dipilih</Badge>}</div>
                  <p className="text-sm text-fg-muted min-h-10">{row.description || 'Plan organizer untuk kebutuhan operasional.'}</p>
                  <p className="text-xl font-bold text-fg mt-4">{money(price, row.currency)} <span className="text-xs font-normal text-fg-muted">/ {billing === 'MONTHLY' ? 'bulan' : 'tahun'}</span></p>
                </button>;
              })}
            </div>

            {selectedCatalogPlan && <Card className="p-5 mt-4">
              <div className="flex items-center gap-2 mb-4"><CreditCard size={18} className="text-accent"/><h3 className="font-semibold text-fg">Kirim pesanan {selectedCatalogPlan.name}</h3></div>
              <div className="grid md:grid-cols-2 gap-3">
                <input className="input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Nomor WhatsApp" />
                <input className="input" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="URL bukti pembayaran" />
              </div>
              <div className="flex items-center justify-between gap-3 mt-4 flex-wrap"><p className="text-sm text-fg-muted">Total: <strong className="text-fg">{money(selectedPrice, selectedCatalogPlan.currency)}</strong></p><Button loading={submitting} disabled={!whatsapp.trim() || !proofUrl.trim()} onClick={() => void submitUpgrade()}>Kirim Pesanan</Button></div>
            </Card>}
          </section>

          <section className="mb-8">
            <Card className="p-5 border-accent/20">
              <div className="flex items-start gap-3 mb-4"><Sparkles className="text-accent mt-0.5" size={20}/><div><h2 className="text-lg font-bold text-fg">Custom plan</h2><p className="text-sm text-fg-muted mt-1">Butuh kombinasi fitur khusus? Pilih kebutuhanmu. Tidak ada harga yang ditampilkan; admin akan menyiapkan penawaran dan menghubungi kamu.</p></div></div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {CUSTOM_OPTIONS.map(([value, label]) => <label key={value} className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer ${customFeatures.includes(value) ? 'border-accent bg-accent/5' : 'border-surface-border'}`}><input type="checkbox" checked={customFeatures.includes(value)} onChange={() => toggleCustom(value)} /><span className="text-sm text-fg">{label}</span></label>)}
              </div>
              <textarea className="input w-full min-h-28 mt-3" value={customNotes} onChange={(e) => setCustomNotes(e.target.value)} placeholder="Jelaskan kebutuhan custom, jumlah peserta, jumlah soal, atau kebutuhan operasional lain…" />
              <div className="grid md:grid-cols-[1fr_auto] gap-3 mt-3">
                <input className="input" value={customWhatsapp} onChange={(e) => setCustomWhatsapp(e.target.value)} placeholder="Nomor WhatsApp untuk dihubungi admin" />
                <Button loading={customSubmitting} disabled={!customFeatures.length} onClick={() => void submitCustom()} icon={<MessageCircle size={15}/>}>Hubungi Admin</Button>
              </div>
              <p className="text-xs text-fg-muted mt-3">Kontak admin dilakukan melalui kanal resmi SykaBelajar. Nomor kontak tidak ditanam langsung di source code.</p>
            </Card>
          </section>

          <section>
            <div className="mb-4"><h2 className="text-lg font-bold text-fg">Fitur aktif</h2><p className="text-sm text-fg-muted">Entitlement ini tetap berasal dari backend dan menjadi sumber otoritatif.</p></div>
            <div className="grid sm:grid-cols-2 gap-3">
              {items.map((item) => <Card key={item.capability} className="p-4"><div className="flex items-start gap-3"><Gauge size={17} className="text-accent mt-0.5"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg">{labelFor(item.capability)}</p><p className="text-xs text-fg-muted mt-1">{item.limit_value == null ? 'Tanpa batas numerik' : `Maksimal ${Number(item.limit_value).toLocaleString('id-ID')}`}</p>{Object.keys(item.config ?? {}).length > 0 && <p className="text-[11px] text-fg-muted mt-2">Pengaturan tambahan aktif</p>}</div><CheckCircle2 size={15} className="text-accent"/></div></Card>)}
              {!items.length && <Card className="p-8 text-center text-fg-muted sm:col-span-2">Belum ada fitur aktif pada plan ini.</Card>}
            </div>
          </section>
        </>}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardList, CreditCard, Gauge, MessageCircle, Save, Settings2, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';

type Plan = { plan_code: string; name: string; badge: string | null; description: string | null; monthly_price: number; yearly_price: number; currency: string; sort_order: number; is_active: boolean; config: Record<string, unknown> };
type Ent = { id?: string; plan_code: string; capability: string; limit_value: number | null; config: Record<string, unknown> };
type CustomRequest = { id: string; organizer_id: string; requester_user_id: string; requested_features: { features?: string[] } | string[]; notes: string | null; contact_whatsapp: string | null; status: 'PENDING' | 'CONTACTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; admin_note: string | null; created_at: string; updated_at: string; organizer_name?: string; requester_name?: string; requester_username?: string };

const CAPABILITY_LABELS: Record<string, string> = {
  competition_create: 'Jumlah lomba', participant_limit: 'Kapasitas peserta', question_bank: 'Bank soal', question_limit: 'Jumlah soal', manual_grading: 'Penilaian manual', certificate: 'Sertifikat', certificate_serials: 'QR / Serial', analytics: 'Analytics', advanced_reports: 'Laporan lanjutan', bulk_notification: 'Notifikasi massal', custom_branding: 'Custom branding', storage: 'Penyimpanan', essay_ai_assessment: 'AI Assessment esai', twibbon: 'Twibbon', twibbon_canvas: 'Twibbon Canvas', priority_support: 'Prioritas dukungan',
};
const PLAN_HINTS: Record<string, string> = { FREE: 'Untuk mulai mencoba platform', PREMIUM: 'Untuk organizer aktif dan berkembang', PRO: 'Untuk operasional skala besar' };
const STATUS_LABELS: Record<CustomRequest['status'], string> = { PENDING: 'Menunggu ditinjau', CONTACTED: 'Sudah dihubungi', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' };
const FEATURE_OPTIONS = Object.entries(CAPABILITY_LABELS);

function capabilityLabel(key: string) { return CAPABILITY_LABELS[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function money(value: number) { return Number(value || 0).toLocaleString('id-ID'); }
function parseMoney(value: string) { return Number(value.replace(/\D/g, '')) || 0; }
function requestFeatures(value: CustomRequest['requested_features']) { return Array.isArray(value) ? value : value?.features ?? []; }
function statusTone(status: CustomRequest['status']) { if (status === 'APPROVED') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'; if (status === 'REJECTED' || status === 'CANCELLED') return 'border-red-500/20 bg-red-500/10 text-red-300'; if (status === 'CONTACTED') return 'border-blue-500/20 bg-blue-500/10 text-blue-300'; return 'border-amber-500/20 bg-amber-500/10 text-amber-300'; }

export function AdminPlanUsagePage() {
  const { toast } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ents, setEnts] = useState<Ent[]>([]);
  const [requests, setRequests] = useState<CustomRequest[]>([]);
  const [active, setActive] = useState('PREMIUM');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRequests, setShowRequests] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [planResult, entResult, reqResult, organizerResult, profileResult] = await Promise.all([
        supabase.from('plan_catalog').select('*').order('sort_order'),
        supabase.from('plan_entitlements').select('*').order('plan_code').order('capability'),
        supabase.from('organizer_custom_plan_requests').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('organizers').select('id,name'),
        supabase.from('profiles').select('id,full_name,username'),
      ]);
      if (planResult.error) throw planResult.error;
      if (entResult.error) throw entResult.error;
      if (reqResult.error) throw reqResult.error;
      const organizerMap = new Map((organizerResult.data ?? []).map((row) => [row.id, row.name]));
      const profileMap = new Map((profileResult.data ?? []).map((row) => [row.id, { name: row.full_name, username: row.username }]));
      setPlans((planResult.data ?? []) as Plan[]);
      setEnts((entResult.data ?? []) as Ent[]);
      setRequests((reqResult.data ?? []).map((row) => ({ ...row, organizer_name: organizerMap.get(row.organizer_id) ?? 'Organisasi', requester_name: profileMap.get(row.requester_user_id)?.name ?? 'Pengguna', requester_username: profileMap.get(row.requester_user_id)?.username ?? '' })) as CustomRequest[]);
      if (!active && planResult.data?.[0]) setActive(planResult.data[0].plan_code);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal memuat pengaturan paket.', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const plan = plans.find((item) => item.plan_code === active) ?? null;
  const list = useMemo(() => ents.filter((item) => item.plan_code === active), [ents, active]);
  const pendingRequests = requests.filter((request) => request.status === 'PENDING').length;

  const patchPlan = (field: keyof Plan, value: unknown) => setPlans((current) => current.map((item) => item.plan_code === active ? { ...item, [field]: value } : item));
  const patchEnt = (target: Ent, patch: Partial<Ent>) => setEnts((current) => current.map((item) => item === target ? { ...item, ...patch } : item));

  const savePlan = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('plan_catalog').update({ name: plan.name, badge: plan.badge, description: plan.description, monthly_price: Number(plan.monthly_price) || 0, yearly_price: Number(plan.yearly_price) || 0, currency: plan.currency || 'IDR', sort_order: Number(plan.sort_order) || 0, is_active: plan.is_active, updated_at: new Date().toISOString() }).eq('plan_code', plan.plan_code);
      if (error) throw error;
      toast('Paket berhasil disimpan.', 'success');
      await load();
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menyimpan paket.', 'error'); }
    finally { setBusy(false); }
  };

  const saveEnt = async (entry: Ent) => {
    if (!entry.capability) return;
    setBusy(true);
    try {
      if (entry.id) {
        const { error } = await supabase.from('plan_entitlements').update({ capability: entry.capability, limit_value: entry.limit_value == null ? null : Number(entry.limit_value), config: entry.config ?? {} }).eq('id', entry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('plan_entitlements').insert({ plan_code: active, capability: entry.capability, limit_value: entry.limit_value == null ? null : Number(entry.limit_value), config: entry.config ?? {} });
        if (error) throw error;
      }
      toast('Benefit paket diperbarui.', 'success');
      await load();
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menyimpan benefit.', 'error'); }
    finally { setBusy(false); }
  };

  const deleteEnt = async (entry: Ent) => {
    if (!entry.id) { setEnts((current) => current.filter((item) => item !== entry)); return; }
    const { error } = await supabase.from('plan_entitlements').delete().eq('id', entry.id);
    if (error) toast(error.message, 'error'); else { setEnts((current) => current.filter((item) => item.id !== entry.id)); toast('Benefit dihapus.', 'success'); }
  };

  const addEntitlement = () => {
    const missing = FEATURE_OPTIONS.find(([code]) => !list.some((entry) => entry.capability === code));
    if (!missing) { toast('Semua benefit standar sudah tersedia di paket ini.', 'info'); return; }
    setEnts((current) => [...current, { plan_code: active, capability: missing[0], limit_value: 1, config: {} }]);
  };

  const updateRequest = async (request: CustomRequest, patch: Partial<CustomRequest>) => {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const payload: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
      if (patch.status && patch.status !== 'PENDING') { payload.reviewed_by = auth.user?.id ?? null; payload.reviewed_at = new Date().toISOString(); }
      const { error } = await supabase.from('organizer_custom_plan_requests').update(payload).eq('id', request.id);
      if (error) throw error;
      toast('Request custom diperbarui.', 'success');
      await load();
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal memperbarui request.', 'error'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen surface-bg p-4 md:p-7 text-fg-secondary">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">Admin · Commerce</p><h1 className="font-display mt-1 text-3xl font-bold text-fg">Paket & Penggunaan</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">Kelola harga, status paket, dan batas fitur tanpa perlu memahami kode backend. Perubahan di sini langsung menjadi sumber konfigurasi untuk halaman Paket Organizer.</p></div>
        <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-elevated/35 px-4 py-3 text-sm"><ShieldCheck size={17} className="text-accent" /><span className="text-fg">Backend terhubung</span></div>
      </header>

      {loading ? <Card className="p-10 text-center text-fg-muted">Memuat pengaturan paket…</Card> : <>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((item) => <button type="button" key={item.plan_code} onClick={() => setActive(item.plan_code)} className={`rounded-2xl border p-4 text-left transition ${item.plan_code === active ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5' : 'border-surface-border bg-surface-elevated/25 hover:bg-surface-elevated/50'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-base font-bold text-fg">{item.name}</p><p className="mt-0.5 text-xs text-fg-muted">{PLAN_HINTS[item.plan_code] ?? 'Paket organizer'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${item.is_active ? 'bg-accent/10 text-accent' : 'bg-fg-muted/10 text-fg-muted'}`}>{item.is_active ? 'AKTIF' : 'NONAKTIF'}</span></div><div className="mt-4 flex items-end justify-between"><div><p className="text-[10px] uppercase tracking-wider text-fg-muted">Mulai dari</p><p className="mt-1 text-lg font-bold text-fg">Rp {money(item.monthly_price)}<span className="text-xs font-normal text-fg-muted"> / bulan</span></p></div><ChevronDown size={16} className={`transition ${item.plan_code === active ? 'rotate-[-90deg] text-accent' : 'text-fg-muted'}`} /></div></button>)}
        </div>

        {plan && <Card className="overflow-hidden p-5 md:p-6">
          <div className="flex flex-col gap-4 border-b border-surface-border pb-5 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><Settings2 size={18} className="text-accent" /><h2 className="text-xl font-bold text-fg">Pengaturan {plan.name}</h2></div><p className="mt-1 text-sm text-fg-muted">Atur informasi yang akan dilihat organizer. Kode internal paket tidak perlu diubah.</p></div><Button disabled={busy} onClick={() => void savePlan()} icon={<Save size={15} />}>Simpan Perubahan</Button></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-fg-muted">Nama paket<input className="input mt-1 w-full" value={plan.name} onChange={(e) => patchPlan('name', e.target.value)} /></label>
            <label className="text-xs font-medium text-fg-muted">Badge singkat<input className="input mt-1 w-full" value={plan.badge ?? ''} onChange={(e) => patchPlan('badge', e.target.value || null)} placeholder="Contoh: Populer" /></label>
            <label className="text-xs font-medium text-fg-muted md:col-span-2">Deskripsi singkat<textarea className="input mt-1 min-h-24 w-full" value={plan.description ?? ''} onChange={(e) => patchPlan('description', e.target.value || null)} /></label>
            <label className="text-xs font-medium text-fg-muted">Harga bulanan (Rp)<input className="input mt-1 w-full" inputMode="numeric" value={money(plan.monthly_price)} onChange={(e) => patchPlan('monthly_price', parseMoney(e.target.value))} /></label>
            <label className="text-xs font-medium text-fg-muted">Harga tahunan (Rp)<input className="input mt-1 w-full" inputMode="numeric" value={money(plan.yearly_price)} onChange={(e) => patchPlan('yearly_price', parseMoney(e.target.value))} /></label>
            <label className="text-xs font-medium text-fg-muted">Urutan tampil<input type="number" min="0" className="input mt-1 w-full" value={plan.sort_order} onChange={(e) => patchPlan('sort_order', Number(e.target.value))} /></label>
            <label className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-elevated/25 p-3 text-sm text-fg"><input type="checkbox" checked={plan.is_active} onChange={(e) => patchPlan('is_active', e.target.checked)} /><span><strong className="block">Tampilkan ke organizer</strong><span className="text-xs text-fg-muted">Nonaktifkan jika paket sementara tidak boleh dipesan.</span></span></label>
          </div>
        </Card>}

        {plan && <Card className="p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><Gauge size={18} className="text-accent" /><h2 className="text-xl font-bold text-fg">Benefit & batas penggunaan</h2></div><p className="mt-1 text-sm text-fg-muted">Gunakan bahasa sederhana seperti “2.000 peserta” atau “Analytics”. Pengaturan teknis tetap disimpan di backend.</p></div><Button size="sm" variant="outline" disabled={busy} onClick={addEntitlement}>Tambah Benefit</Button></div>
          <div className="mt-5 space-y-3">{list.map((entry, index) => <div key={entry.id ?? `new-${index}`} className="rounded-2xl border border-surface-border bg-surface-elevated/25 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_auto] md:items-end"><label className="text-xs font-medium text-fg-muted">Benefit<select className="input mt-1 w-full" value={entry.capability} onChange={(e) => patchEnt(entry, { capability: e.target.value })}>{FEATURE_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label className="text-xs font-medium text-fg-muted">Batas / jumlah<input type="number" min="0" className="input mt-1 w-full" value={entry.limit_value ?? ''} onChange={(e) => patchEnt(entry, { limit_value: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Kosong = tanpa angka" /></label><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void saveEnt(entry)}><Save size={14} /></Button><button type="button" className="rounded-lg p-2 text-red-400 hover:bg-red-500/10" onClick={() => void deleteEnt(entry)} aria-label="Hapus benefit"><Trash2 size={15} /></button></div></div>{entry.config && Object.keys(entry.config).length > 0 && <p className="mt-3 rounded-lg bg-surface-elevated/40 px-3 py-2 text-[11px] text-fg-muted">Pengaturan tambahan aktif: {Object.entries(entry.config).map(([key, value]) => `${key === 'qr' ? 'QR' : key === 'scope' ? 'cakupan' : key}: ${String(value)}`).join(' · ')}</p>}</div>)}{!list.length && <div className="rounded-xl border border-dashed border-surface-border p-8 text-center text-sm text-fg-muted">Belum ada benefit untuk paket ini.</div>}</div>
        </Card>}

        <Card className="overflow-hidden p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><ClipboardList size={18} className="text-accent" /><h2 className="text-xl font-bold text-fg">Request paket Custom</h2>{pendingRequests > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">{pendingRequests} baru</span>}</div><p className="mt-1 text-sm text-fg-muted">Semua permintaan Custom dari organizer masuk ke sini. Tidak perlu mencari data dari tabel database.</p></div><button type="button" onClick={() => setShowRequests((value) => !value)} className="rounded-xl border border-surface-border px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-elevated">{showRequests ? 'Sembunyikan' : 'Tampilkan request'}</button></div>
          {showRequests && <div className="mt-5 space-y-3">{requests.map((request) => <div key={request.id} className="rounded-2xl border border-surface-border bg-surface-elevated/20 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-fg">{request.organizer_name}</p><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusTone(request.status)}`}>{STATUS_LABELS[request.status]}</span></div><p className="mt-1 text-xs text-fg-muted">{request.requester_name}{request.requester_username ? ` · @${request.requester_username}` : ''} · {new Date(request.created_at).toLocaleString('id-ID')}</p><div className="mt-3 flex flex-wrap gap-2">{requestFeatures(request.requested_features).map((feature) => <span key={feature} className="rounded-lg bg-accent/8 px-2.5 py-1.5 text-xs text-fg">{capabilityLabel(feature)}</span>)}</div>{request.notes && <p className="mt-3 rounded-xl border border-surface-border bg-surface-elevated/35 p-3 text-sm leading-5 text-fg-muted">{request.notes}</p>}<div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-muted">{request.contact_whatsapp && <span className="inline-flex items-center gap-1.5"><MessageCircle size={13} className="text-accent" /> {request.contact_whatsapp}</span>}<span className="font-mono text-[10px] opacity-40">ID {request.id.slice(0, 8)}</span></div></div><div className="grid w-full gap-2 lg:w-64"><label className="text-xs font-medium text-fg-muted">Status<select className="input mt-1 w-full" value={request.status} onChange={(e) => void updateRequest(request, { status: e.target.value as CustomRequest['status'] })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium text-fg-muted">Catatan admin<textarea className="input mt-1 min-h-20 w-full" defaultValue={request.admin_note ?? ''} placeholder="Contoh: sudah dihubungi, penawaran Rp..." onBlur={(e) => { if (e.target.value !== (request.admin_note ?? '')) void updateRequest(request, { admin_note: e.target.value || null }); }} /></label>{request.contact_whatsapp && <button type="button" onClick={() => { const number = request.contact_whatsapp?.replace(/\D/g, ''); if (number) window.open(`https://wa.me/${number}?text=${encodeURIComponent('Halo, kami dari SykaBelajar menindaklanjuti request paket Custom Anda.')}`, '_blank', 'noopener,noreferrer'); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-elevated"><MessageCircle size={14} /> Hubungi via WhatsApp</button>}</div></div></div>)}{!requests.length && <div className="rounded-xl border border-dashed border-surface-border p-9 text-center"><ClipboardList size={22} className="mx-auto text-fg-muted" /><p className="mt-2 text-sm font-semibold text-fg">Belum ada request Custom</p><p className="mt-1 text-xs text-fg-muted">Request baru akan muncul otomatis setelah organizer mengirimkannya.</p></div>}</div>}
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[['Paket aktif', plans.filter((item) => item.is_active).length, CreditCard], ['Total benefit', ents.filter((item) => item.plan_code === active).length, Gauge], ['Request Custom', requests.length, ClipboardList], ['Perlu ditinjau', pendingRequests, Users]].map(([label, value, Icon]) => <Card key={String(label)} className="p-4"><Icon size={17} className="text-accent" /><p className="mt-3 text-xs text-fg-muted">{label}</p><p className="mt-1 text-2xl font-bold text-fg">{String(value)}</p></Card>)}
        </div>
      </>}
    </div>
  </div>;
}

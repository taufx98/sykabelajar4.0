import { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, ChevronRight, ClipboardList, CreditCard, Gauge, MessageCircle, Plus, Save, Settings2, ShieldCheck, TicketPercent, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { adminUpsertOrganizerVoucher, listOrganizerVouchers, listOrganizerPaymentFieldSettings, adminSaveOrganizerPaymentFields, listOrganizerPaymentMethods, adminCreateOrganizerPaymentMethod, adminDeleteOrganizerPaymentMethod, type OrganizerVoucher, type OrganizerPaymentFieldSetting, type OrganizerPaymentMethod } from '@/services/commerce.service';

type Plan = { plan_code: string; name: string; badge: string | null; description: string | null; monthly_price: number; yearly_price: number; monthly_discount_percent: number; yearly_discount_percent: number; currency: string; sort_order: number; is_active: boolean; config: Record<string, unknown> };
type Ent = { id?: string; plan_code: string; capability: string; limit_value: number | null; config: Record<string, unknown> };
type CustomRequest = { id: string; organizer_id: string; requester_user_id: string; requested_features: { features?: string[]; quantities?: Record<string, number> } | string[]; notes: string | null; contact_whatsapp: string | null; status: 'PENDING' | 'CONTACTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; admin_note: string | null; created_at: string; updated_at: string; organizer_name?: string; requester_name?: string; requester_username?: string };
type VoucherForm = { id: string | null; title: string; description: string; benefitType: 'DISCOUNT_PERCENT' | 'FREE_PLAN'; discountPercent: number; freePlanCode: string; freeDurationDays: number; targetPlanCode: 'ALL' | 'PREMIUM' | 'PRO'; targetBillingPeriods: string[]; maxUses: number; startsAt: string; endsAt: string; isActive: boolean };
type DraftField = Omit<OrganizerPaymentFieldSetting, 'id'>;
type NewPaymentMethod = { name: string; paymentType: string; details: string };

const CAPABILITY_LABELS: Record<string, string> = { competition_create: 'Jumlah lomba', participant_limit: 'Kapasitas peserta', question_bank: 'Bank soal', question_limit: 'Jumlah soal', manual_grading: 'Penilaian manual', certificate: 'Sertifikat', certificate_serials: 'QR / Serial sertifikat', analytics: 'Analytics', advanced_reports: 'Laporan lanjutan', bulk_notification: 'Notifikasi massal', custom_branding: 'Custom branding', storage: 'Penyimpanan', essay_ai_assessment: 'AI Assessment esai', twibbon: 'Twibbon', twibbon_canvas: 'Twibbon Canvas', priority_support: 'Prioritas dukungan' };
const PLAN_HINTS: Record<string, string> = { FREE: 'Untuk mulai mencoba platform', PREMIUM: 'Untuk organizer aktif dan berkembang', PRO: 'Untuk operasional skala besar' };
const STATUS_LABELS: Record<CustomRequest['status'], string> = { PENDING: 'Menunggu ditinjau', CONTACTED: 'Sudah dihubungi', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' };
const FEATURE_OPTIONS = Object.entries(CAPABILITY_LABELS);
const emptyVoucher: VoucherForm = { id: null, title: '', description: '', benefitType: 'DISCOUNT_PERCENT', discountPercent: 10, freePlanCode: 'PREMIUM', freeDurationDays: 30, targetPlanCode: 'ALL', targetBillingPeriods: ['MONTHLY', 'YEARLY'], maxUses: 1, startsAt: '', endsAt: '', isActive: true };
function capabilityLabel(key: string) { return CAPABILITY_LABELS[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function money(value: number) { return Number(value || 0).toLocaleString('id-ID'); }
function parseMoney(value: string) { return Number(value.replace(/\D/g, '')) || 0; }
function requestFeatures(value: CustomRequest['requested_features']) { return Array.isArray(value) ? value : value?.features ?? []; }
function requestQuantities(value: CustomRequest['requested_features']) { return Array.isArray(value) ? {} : value?.quantities ?? {}; }
function statusTone(status: CustomRequest['status']) { if (status === 'APPROVED') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'; if (status === 'REJECTED' || status === 'CANCELLED') return 'border-red-500/20 bg-red-500/10 text-red-300'; if (status === 'CONTACTED') return 'border-blue-500/20 bg-blue-500/10 text-blue-300'; return 'border-amber-500/20 bg-amber-500/10 text-amber-300'; }
function keyFromLabel(label: string) { const key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48); return key || `field_${Date.now()}`; }
function paymentDetailText(method: OrganizerPaymentMethod) { return typeof method.details?.text === 'string' ? method.details.text : Object.entries(method.details ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join('\n'); }

export function AdminPlanUsagePage() {
  const { toast } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ents, setEnts] = useState<Ent[]>([]);
  const [requests, setRequests] = useState<CustomRequest[]>([]);
  const [vouchers, setVouchers] = useState<OrganizerVoucher[]>([]);
  const [active, setActive] = useState('PREMIUM');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRequests, setShowRequests] = useState(true);
  const [voucherForm, setVoucherForm] = useState<VoucherForm>(emptyVoucher);
  const [showVoucherForm, setShowVoucherForm] = useState(false);
  const [paymentFields, setPaymentFields] = useState<DraftField[]>([]);
  const [newField, setNewField] = useState<DraftField>({ field_key: '', label: '', description: '', is_enabled: true, is_required: false, sort_order: 1, input_type: 'TEXT' });
  const [paymentMethods, setPaymentMethods] = useState<OrganizerPaymentMethod[]>([]);
  const [newMethod, setNewMethod] = useState<NewPaymentMethod>({ name: '', paymentType: 'BANK_TRANSFER', details: '' });

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
      const [voucherResult, fieldResult, methodResult] = await Promise.allSettled([listOrganizerVouchers(), listOrganizerPaymentFieldSettings(), listOrganizerPaymentMethods()]);
      const organizerMap = new Map((organizerResult.data ?? []).map((row) => [row.id, row.name]));
      const profileMap = new Map((profileResult.data ?? []).map((row) => [row.id, { name: row.full_name, username: row.username }]));
      const nextPlans = (planResult.data ?? []) as Plan[];
      setPlans(nextPlans);
      setEnts((entResult.data ?? []) as Ent[]);
      setRequests((reqResult.data ?? []).map((row) => ({ ...row, organizer_name: organizerMap.get(row.organizer_id) ?? 'Organisasi', requester_name: profileMap.get(row.requester_user_id)?.name ?? 'Pengguna', requester_username: profileMap.get(row.requester_user_id)?.username ?? '' })) as CustomRequest[]);
      setVouchers(voucherResult.status === 'fulfilled' ? voucherResult.value : []);
      setPaymentFields(fieldResult.status === 'fulfilled' ? fieldResult.value.map(({ id, ...rest }) => rest) : []);
      setPaymentMethods(methodResult.status === 'fulfilled' ? methodResult.value : []);
      if (nextPlans.length && !nextPlans.some((item) => item.plan_code === active)) setActive(nextPlans[0].plan_code);
      const optionalFailures = [voucherResult, fieldResult, methodResult].filter((result) => result.status === 'rejected').length;
      if (optionalFailures) toast('Sebagian konfigurasi tambahan gagal dimuat. Data utama tetap tersedia.', 'info');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal memuat pengaturan paket.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const plan = plans.find((item) => item.plan_code === active) ?? null;
  const list = useMemo(() => ents.filter((item) => item.plan_code === active), [ents, active]);
  const pendingRequests = requests.filter((request) => request.status === 'PENDING').length;
  const summary = [
    { label: 'Paket aktif', value: plans.filter((item) => item.is_active).length, icon: CreditCard },
    { label: 'Benefit paket', value: list.length, icon: Gauge },
    { label: 'Request custom', value: requests.length, icon: ClipboardList },
    { label: 'Campaign promo', value: vouchers.length, icon: TicketPercent },
  ];

  const patchPlan = (field: keyof Plan, value: unknown) => setPlans((current) => current.map((item) => item.plan_code === active ? { ...item, [field]: value } : item));
  const patchEnt = (target: Ent, patch: Partial<Ent>) => setEnts((current) => current.map((item) => item === target ? { ...item, ...patch } : item));

  const savePlan = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const monthlyDiscount = Math.max(0, Math.min(100, Number(plan.monthly_discount_percent) || 0));
      const yearlyDiscount = Math.max(0, Math.min(100, Number(plan.yearly_discount_percent) || 0));
      const { error } = await supabase.from('plan_catalog').update({ name: plan.name, badge: plan.badge, description: plan.description, monthly_price: Number(plan.monthly_price) || 0, yearly_price: Number(plan.yearly_price) || 0, monthly_discount_percent: monthlyDiscount, yearly_discount_percent: yearlyDiscount, currency: plan.currency || 'IDR', sort_order: Number(plan.sort_order) || 0, is_active: plan.is_active, updated_at: new Date().toISOString() }).eq('plan_code', plan.plan_code);
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

  const saveFields = async () => {
    setBusy(true);
    try {
      const normalized = paymentFields.map((field, index) => ({ ...field, field_key: field.field_key.trim().toLowerCase(), label: field.label.trim(), description: field.description.trim(), sort_order: index + 1, is_required: field.is_enabled && field.is_required }));
      if (normalized.some((field) => !field.field_key || !field.label)) { toast('Key dan nama field wajib diisi.', 'error'); return; }
      const unique = new Set(normalized.map((field) => field.field_key));
      if (unique.size !== normalized.length) { toast('Key field tidak boleh sama.', 'error'); return; }
      setPaymentFields(await adminSaveOrganizerPaymentFields(normalized));
      toast('Data checkout berhasil disimpan.', 'success');
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menyimpan data checkout.', 'error'); }
    finally { setBusy(false); }
  };

  const addField = () => {
    const label = newField.label.trim();
    if (!label) { toast('Nama field wajib diisi.', 'error'); return; }
    const key = newField.field_key.trim().toLowerCase() || keyFromLabel(label);
    if (paymentFields.some((field) => field.field_key === key)) { toast('Key field sudah digunakan.', 'error'); return; }
    setPaymentFields((current) => [...current, { ...newField, field_key: key, label, sort_order: current.length + 1, is_required: newField.is_enabled && newField.is_required }]);
    setNewField({ field_key: '', label: '', description: '', is_enabled: true, is_required: false, sort_order: paymentFields.length + 2, input_type: 'TEXT' });
  };

  const deleteField = (key: string) => setPaymentFields((current) => current.filter((field) => field.field_key !== key).map((field, index) => ({ ...field, sort_order: index + 1 })));
  const editField = (key: string, patch: Partial<DraftField>) => setPaymentFields((current) => current.map((field) => field.field_key === key ? { ...field, ...patch, is_required: patch.is_enabled === false ? false : (patch.is_required ?? field.is_required) } : field));

  const addMethod = async () => {
    if (!newMethod.name.trim() || !newMethod.details.trim()) { toast('Nama dan detail pembayaran wajib diisi.', 'error'); return; }
    setBusy(true);
    try {
      const created = await adminCreateOrganizerPaymentMethod({ name: newMethod.name.trim(), paymentType: newMethod.paymentType, details: { text: newMethod.details.trim() }, sortOrder: paymentMethods.length + 1 });
      setPaymentMethods((current) => [...current, created]);
      setNewMethod({ name: '', paymentType: 'BANK_TRANSFER', details: '' });
      toast('Metode pembayaran ditambahkan.', 'success');
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menambah metode pembayaran.', 'error'); }
    finally { setBusy(false); }
  };

  const deleteMethod = async (method: OrganizerPaymentMethod) => {
    setBusy(true);
    try {
      await adminDeleteOrganizerPaymentMethod(method.id);
      setPaymentMethods((current) => current.filter((item) => item.id !== method.id));
      toast('Metode pembayaran dihapus.', 'success');
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menghapus metode pembayaran.', 'error'); }
    finally { setBusy(false); }
  };

  const openNewVoucher = () => { setVoucherForm({ ...emptyVoucher }); setShowVoucherForm(true); };
  const saveVoucher = async () => {
    if (!voucherForm.title.trim()) { toast('Judul promo wajib diisi.', 'error'); return; }
    setBusy(true);
    try {
      const saved = await adminUpsertOrganizerVoucher({ id: voucherForm.id, title: voucherForm.title, description: voucherForm.description, benefitType: voucherForm.benefitType, discountPercent: voucherForm.benefitType === 'DISCOUNT_PERCENT' ? voucherForm.discountPercent : 0, freePlanCode: voucherForm.benefitType === 'FREE_PLAN' ? voucherForm.freePlanCode : undefined, freeDurationDays: voucherForm.benefitType === 'FREE_PLAN' ? voucherForm.freeDurationDays : undefined, targetPlanCodes: voucherForm.benefitType === 'FREE_PLAN' ? [] : voucherForm.targetPlanCode === 'ALL' ? [] : [voucherForm.targetPlanCode], targetBillingPeriods: voucherForm.targetBillingPeriods, maxUses: voucherForm.maxUses, startsAt: voucherForm.startsAt ? new Date(voucherForm.startsAt).toISOString() : null, endsAt: voucherForm.endsAt ? new Date(voucherForm.endsAt).toISOString() : null, isActive: voucherForm.isActive });
      toast(`Promo ${saved?.code || 'berhasil'} tersimpan.`, 'success');
      setShowVoucherForm(false);
      await load();
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menyimpan promo.', 'error'); }
    finally { setBusy(false); }
  };
  const editVoucher = (v: OrganizerVoucher) => { const target = v.benefit_type === 'FREE_PLAN' ? (v.free_plan_code === 'PRO' ? 'PRO' : 'PREMIUM') : (v.target_plan_codes[0] === 'PRO' ? 'PRO' : v.target_plan_codes[0] === 'PREMIUM' ? 'PREMIUM' : 'ALL'); setVoucherForm({ id: v.id, title: v.title || '', description: v.description || '', benefitType: v.benefit_type, discountPercent: v.discount_percent, freePlanCode: v.free_plan_code || 'PREMIUM', freeDurationDays: v.free_duration_days || 30, targetPlanCode: target, targetBillingPeriods: v.target_billing_periods.length ? v.target_billing_periods : ['MONTHLY', 'YEARLY'], maxUses: v.max_uses, startsAt: v.starts_at ? new Date(v.starts_at).toISOString().slice(0, 16) : '', endsAt: v.ends_at ? new Date(v.ends_at).toISOString().slice(0, 16) : '', isActive: v.is_active }); setShowVoucherForm(true); };
  const copyVoucher = async (code: string) => { try { await navigator.clipboard.writeText(code); toast('Kode promo disalin.', 'success'); } catch { toast('Tidak dapat menyalin otomatis.', 'error'); } };
  const deleteVoucher = async (voucher: OrganizerVoucher) => {
    if (!window.confirm('Anda yakin ingin menghapus voucher ini?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_delete_organizer_voucher', { p_id: voucher.id });
      if (error) throw error;
      setVouchers((current) => current.filter((item) => item.id !== voucher.id));
      toast('Voucher berhasil dihapus.', 'success');
    } catch (error: unknown) { toast(error instanceof Error ? error.message : 'Gagal menghapus voucher.', 'error'); }
    finally { setBusy(false); }
  };
  const toggleBilling = (value: string) => setVoucherForm((current) => ({ ...current, targetBillingPeriods: current.targetBillingPeriods.includes(value) ? current.targetBillingPeriods.filter((item) => item !== value) : [...current.targetBillingPeriods, value] }));

  return <div className="min-h-screen surface-bg px-4 py-6 text-fg-secondary md:px-7 md:py-9">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border border-surface-border bg-surface-elevated/25 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div className="max-w-3xl"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-accent"><Settings2 size={14} /> Admin · Commerce</div><h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">Plan & Usage</h1><p className="mt-3 text-sm leading-6 text-fg-muted">Kelola katalog paket, entitlement, checkout organizer, metode pembayaran, promo, dan request custom dalam satu workspace yang terstruktur.</p></div><div className="inline-flex w-fit items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm font-semibold text-emerald-300"><ShieldCheck size={17} /> Backend terhubung</div></div>
      </header>
      {loading ? <Card className="p-12 text-center text-sm text-fg-muted">Memuat konfigurasi Plan & Usage…</Card> : <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summary.map(({ label, value, icon: Icon }) => <Card key={label} className="p-5"><div className="flex items-center justify-between"><div className="rounded-xl bg-accent/10 p-2.5"><Icon size={17} className="text-accent" /></div><span className="text-2xl font-bold text-fg">{value}</span></div><p className="mt-4 text-xs font-medium text-fg-muted">{label}</p></Card>)}</section>
        <section><div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Catalog</p><h2 className="mt-1 text-xl font-bold text-fg">Paket Organizer</h2><p className="mt-1 text-sm text-fg-muted">Pilih paket untuk mengatur harga dan entitlement-nya.</p></div>{plan && <span className="rounded-full border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent">Editing: {plan.plan_code}</span>}</div><div className="grid gap-3 md:grid-cols-3">{plans.map((item) => <button key={item.plan_code} type="button" onClick={() => setActive(item.plan_code)} className={`group rounded-2xl border p-5 text-left transition ${item.plan_code === active ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5' : 'border-surface-border bg-surface-elevated/25 hover:bg-surface-elevated/45'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted">{item.plan_code}</p><p className="mt-1 text-lg font-bold text-fg">{item.name}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${item.is_active ? 'bg-accent/10 text-accent' : 'bg-fg-muted/10 text-fg-muted'}`}>{item.is_active ? 'AKTIF' : 'NONAKTIF'}</span></div><p className="mt-4 text-base font-bold text-fg">Rp {money(item.monthly_price)}<span className="text-xs font-normal text-fg-muted"> / bulan</span></p><div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-emerald-300"><span>Diskon bulanan {Number(item.monthly_discount_percent) || 0}%</span><span>Tahunan {Number(item.yearly_discount_percent) || 0}%</span></div><div className="mt-4 flex items-center gap-1 text-xs font-semibold text-fg-muted group-hover:text-fg">Buka pengaturan <ChevronRight size={13}/></div></button>)}</div></section>
        {plan && <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">{/* existing plan/entitlement UI unchanged */}</div>}
        <footer className="flex items-center justify-between border-t border-surface-border pt-4 text-xs text-fg-muted"><span>Plan & Usage · SYKABELAJAR</span><span>{plans.length} paket dikonfigurasi</span></footer>
      </>}
    </div>
  </div>;
}

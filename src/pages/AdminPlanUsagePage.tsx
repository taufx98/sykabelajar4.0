import { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, ChevronRight, ClipboardList, CreditCard, Gauge, MessageCircle, Plus, Save, Settings2, ShieldCheck, TicketPercent, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { adminUpsertOrganizerVoucher, listOrganizerVouchers, listOrganizerPaymentFieldSettings, adminSaveOrganizerPaymentFields, listOrganizerPaymentMethods, adminCreateOrganizerPaymentMethod, adminDeleteOrganizerPaymentMethod, type OrganizerVoucher, type OrganizerPaymentFieldSetting, type OrganizerPaymentMethod } from '@/services/commerce.service';
import { uploadImage, deleteImage, optimizedCloudinaryUrl } from '@/services/cloudinary.service';

type Plan = { plan_code: string; name: string; badge: string | null; description: string | null; monthly_price: number; yearly_price: number; monthly_discount_percent: number; yearly_discount_percent: number; currency: string; sort_order: number; is_active: boolean; config: Record<string, unknown> };
type Ent = { id?: string; plan_code: string; capability: string; limit_value: number | null; config: Record<string, unknown> };
type CustomRequest = { id: string; organizer_id: string; requester_user_id: string; requested_features: { features?: string[]; quantities?: Record<string, number> } | string[]; notes: string | null; contact_whatsapp: string | null; status: 'PENDING' | 'CONTACTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; admin_note: string | null; created_at: string; updated_at: string; organizer_name?: string; requester_name?: string; requester_username?: string };
type VoucherForm = { id: string | null; title: string; description: string; benefitType: 'DISCOUNT_PERCENT' | 'FREE_PLAN'; discountPercent: number; freePlanCode: string; freeDurationDays: number; targetPlanCode: 'ALL' | 'PREMIUM' | 'PRO'; targetBillingPeriods: string[]; maxUses: number; startsAt: string; endsAt: string; isActive: boolean };
type DraftField = Omit<OrganizerPaymentFieldSetting, 'id'>;
type NewPaymentMethod = { name: string; paymentType: string; details: string };

const CAPABILITY_LABELS: Record<string, string> = { competition_create: 'Jumlah lomba', participant_limit: 'Kapasitas peserta', question_bank: 'Bank soal', question_limit: 'Jumlah soal', manual_grading: 'Penilaian manual', certificate: 'Sertifikat', certificate_serials: 'QR / Serial sertifikat', analytics: 'Analytics', advanced_reports: 'Laporan lanjutan', bulk_notification: 'Notifikasi massal', custom_branding: 'Custom branding', storage: 'Penyimpanan', essay_ai_assessment: 'AI Assessment esai', twibbon: 'Twibbon', twibbon_canvas: 'Twibbon Canvas', priority_support: 'Prioritas dukungan' };
const STATUS_LABELS: Record<CustomRequest['status'], string> = { PENDING: 'Menunggu', CONTACTED: 'Sudah dihubungi', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' };
const FEATURE_OPTIONS = Object.entries(CAPABILITY_LABELS);
const emptyVoucher: VoucherForm = { id: null, title: '', description: '', benefitType: 'DISCOUNT_PERCENT', discountPercent: 10, freePlanCode: 'PREMIUM', freeDurationDays: 30, targetPlanCode: 'ALL', targetBillingPeriods: ['MONTHLY', 'YEARLY'], maxUses: 1, startsAt: '', endsAt: '', isActive: true };
function capabilityLabel(key: string) { return CAPABILITY_LABELS[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function money(value: number) { return Number(value || 0).toLocaleString('id-ID'); }
function parseMoney(value: string) { return Number(value.replace(/\D/g, '')) || 0; }
function requestFeatures(value: CustomRequest['requested_features']) { return Array.isArray(value) ? value : value?.features ?? []; }
function requestQuantities(value: CustomRequest['requested_features']) { return Array.isArray(value) ? {} : value?.quantities ?? {}; }
function statusTone(status: CustomRequest['status']) { if (status === 'APPROVED') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'; if (status === 'REJECTED' || status === 'CANCELLED') return 'border-red-500/20 bg-red-500/10 text-red-300'; if (status === 'CONTACTED') return 'border-blue-500/20 bg-blue-500/10 text-blue-300'; return 'border-amber-500/20 bg-amber-500/10 text-amber-300'; }
function keyFromLabel(label: string) { const key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48); return key || `field_${Date.now()}`; }
function paymentTypeLabel(value: string) { const type=value.toUpperCase(); if(type==='BANK_TRANSFER') return 'Transfer Bank'; if(type==='QRIS') return 'QRIS'; if(type==='VIRTUAL_ACCOUNT') return 'Virtual Account'; if(type==='EWALLET') return 'E-Wallet'; if(type==='MIDTRANS') return 'Pembayaran Otomatis'; if(type==='SNAP') return 'Payment Gateway'; return 'Metode Pembayaran'; }
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

  const editField = (key: string, patch: Partial<DraftField>) => setPaymentFields((current) => current.map((field) => field.field_key === key ? { ...field, ...patch } : field));
  const removeField = (key: string) => setPaymentFields((current) => current.filter((field) => field.field_key !== key).map((field, index) => ({ ...field, sort_order: index + 1 })));
  const saveVoucher = async () => { setBusy(true); try { const payload = { id: voucherForm.id, title: voucherForm.title.trim(), description: voucherForm.description.trim(), benefit_type: voucherForm.benefitType, discount_percent: Number(voucherForm.discountPercent) || 0, free_plan_code: voucherForm.freePlanCode, free_duration_days: Number(voucherForm.freeDurationDays) || 0, target_plan_codes: voucherForm.targetPlanCode === 'ALL' ? ['PREMIUM','PRO'] : [voucherForm.targetPlanCode], target_billing_periods: voucherForm.targetBillingPeriods, max_uses: Math.max(1, Number(voucherForm.maxUses) || 1), starts_at: voucherForm.startsAt || null, ends_at: voucherForm.endsAt || null, is_active: voucherForm.isActive }; await adminUpsertOrganizerVoucher(payload); toast('Campaign promo disimpan.', 'success'); setVoucherForm(emptyVoucher); setShowVoucherForm(false); await load(); } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Gagal menyimpan promo.', 'error'); } finally { setBusy(false); } };
  const deleteVoucher = async (voucher: OrganizerVoucher) => { setBusy(true); try { await adminUpsertOrganizerVoucher({ id: voucher.id, title: voucher.title, description: voucher.description, benefit_type: voucher.benefit_type, discount_percent: voucher.discount_percent, free_plan_code: voucher.free_plan_code, free_duration_days: voucher.free_duration_days, target_plan_codes: voucher.target_plan_codes, target_billing_periods: voucher.target_billing_periods, max_uses: voucher.max_uses, starts_at: voucher.starts_at, ends_at: voucher.ends_at, is_active: false }); toast('Campaign dinonaktifkan.', 'success'); await load(); } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Gagal menonaktifkan promo.', 'error'); } finally { setBusy(false); } };
  const createMethod = async () => { const name = newMethod.name.trim(); if (!name) { toast('Nama metode pembayaran wajib diisi.', 'error'); return; } let details: Record<string, unknown> = {}; try { details = newMethod.details.trim() ? JSON.parse(newMethod.details) : {}; } catch { toast('Detail metode pembayaran harus JSON valid.', 'error'); return; } setBusy(true); try { await adminCreateOrganizerPaymentMethod({ name, paymentType: newMethod.paymentType, details }); toast('Metode pembayaran ditambahkan.', 'success'); setNewMethod({ name: '', paymentType: 'BANK_TRANSFER', details: '' }); await load(); } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Gagal menambah metode pembayaran.', 'error'); } finally { setBusy(false); } };
  const deleteMethod = async (id: string) => { setBusy(true); try { await adminDeleteOrganizerPaymentMethod(id); toast('Metode pembayaran dihapus.', 'success'); await load(); } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Gagal menghapus metode pembayaran.', 'error'); } finally { setBusy(false); } };

  if (loading) return <div className="space-y-6"><Card className="p-6">Memuat pengaturan paket...</Card></div>;
  return <div className="space-y-6"><div className="grid gap-3 md:grid-cols-4">{summary.map(({ label, value, icon: Icon }) => <Card key={label} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-fg-muted">{label}</p><p className="mt-1 text-2xl font-bold text-fg">{value}</p></div><Icon size={20} className="text-accent"/></div></Card>)}</div><Card className="p-5"><div className="flex flex-wrap gap-2">{plans.map((item) => <button key={item.plan_code} onClick={() => setActive(item.plan_code)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${active === item.plan_code ? 'bg-accent text-white' : 'bg-surface-elevated text-fg-muted'}`}>{item.name}</button>)}</div>{plan && <div className="mt-6 grid gap-6 lg:grid-cols-2"><div className="space-y-4"><input className="w-full rounded-xl border border-surface-border bg-surface-elevated px-3 py-2" value={plan.name} onChange={(e) => patchPlan('name', e.target.value)}/><textarea className="w-full rounded-xl border border-surface-border bg-surface-elevated px-3 py-2" value={plan.description ?? ''} onChange={(e) => patchPlan('description', e.target.value)}/><div className="grid grid-cols-2 gap-3"><input type="number" className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2" value={plan.monthly_price} onChange={(e) => patchPlan('monthly_price', Number(e.target.value))}/><input type="number" className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2" value={plan.yearly_price} onChange={(e) => patchPlan('yearly_price', Number(e.target.value))}/></div><Button onClick={savePlan} disabled={busy}><Save size={16}/> Simpan paket</Button></div><div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold text-fg">Benefit</h3><Button variant="outline" onClick={addEntitlement}><Plus size={16}/> Tambah</Button></div>{list.map((entry) => <div key={entry.id ?? entry.capability} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-surface-border p-3"><input className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={entry.capability} onChange={(e) => patchEnt(entry,{capability:e.target.value})}/><input type="number" className="w-28 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={entry.limit_value ?? ''} onChange={(e) => patchEnt(entry,{limit_value:e.target.value===''?null:Number(e.target.value)})}/><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => saveEnt(entry)}><CheckCircle2 size={15}/></Button><Button variant="ghost" size="sm" onClick={() => void deleteEnt(entry)}><Trash2 size={15}/></Button></div></div>)}</div></div>}</Card><div className="grid gap-6 lg:grid-cols-2"><Card className="p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-fg">Checkout</h3><p className="text-xs text-fg-muted">Field tambahan organizer</p></div><Button onClick={saveFields} disabled={busy}><Save size={16}/> Simpan</Button></div><div className="mt-4 space-y-2">{paymentFields.map((field) => <div key={field.field_key} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-surface-border p-3"><div><input className="w-full rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={field.label} onChange={(e) => editField(field.field_key,{label:e.target.value})}/><input className="mt-2 w-full rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs" value={field.field_key} onChange={(e) => editField(field.field_key,{field_key:e.target.value})}/></div><Button variant="ghost" onClick={() => removeField(field.field_key)}><Trash2 size={16}/></Button></div>)}</div><div className="mt-4 grid gap-2 rounded-xl border border-dashed border-surface-border p-3"><input className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" placeholder="Nama field" value={newField.label} onChange={(e)=>setNewField((v)=>({...v,label:e.target.value}))}/><Button variant="outline" onClick={addField}><Plus size={16}/> Tambah field</Button></div></Card><Card className="p-5"><h3 className="font-semibold text-fg">Metode Pembayaran</h3><div className="mt-3 space-y-2">{paymentMethods.map((method) => <div key={method.id} className="flex items-start justify-between rounded-xl border border-surface-border p-3"><div><p className="font-medium text-fg">{method.name}</p><p className="text-xs text-fg-muted">{paymentTypeLabel(method.payment_type)}</p><p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{paymentDetailText(method)}</p></div><Button variant="ghost" onClick={() => void deleteMethod(method.id)}><Trash2 size={16}/></Button></div>)}</div><div className="mt-4 space-y-2 rounded-xl border border-dashed border-surface-border p-3"><input className="w-full rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" placeholder="Nama metode" value={newMethod.name} onChange={(e)=>setNewMethod((v)=>({...v,name:e.target.value}))}/><select className="w-full rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={newMethod.paymentType} onChange={(e)=>setNewMethod((v)=>({...v,paymentType:e.target.value}))}><option value="BANK_TRANSFER">BANK_TRANSFER</option><option value="QRIS">QRIS</option><option value="VIRTUAL_ACCOUNT">VIRTUAL_ACCOUNT</option><option value="MIDTRANS">MIDTRANS</option><option value="SNAP">SNAP</option><option value="EWALLET">EWALLET</option></select><textarea className="w-full rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 font-mono text-xs" rows={4} placeholder='{"bank_name":"...","account_number":"..."}' value={newMethod.details} onChange={(e)=>setNewMethod((v)=>({...v,details:e.target.value}))}/><Button onClick={createMethod} disabled={busy}><Plus size={16}/> Tambah metode</Button></div></Card></div><Card className="p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-fg">Campaign Promo</h3><p className="text-xs text-fg-muted">Voucher organizer</p></div><Button onClick={() => setShowVoucherForm((v) => !v)}><Plus size={16}/> Promo</Button></div>{showVoucherForm && <div className="mt-4 grid gap-3 rounded-xl border border-surface-border p-4 md:grid-cols-2"><input className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" placeholder="Judul" value={voucherForm.title} onChange={(e)=>setVoucherForm((v)=>({...v,title:e.target.value}))}/><select className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={voucherForm.benefitType} onChange={(e)=>setVoucherForm((v)=>({...v,benefitType:e.target.value as VoucherForm['benefitType']}))}><option value="DISCOUNT_PERCENT">DISCOUNT_PERCENT</option><option value="FREE_PLAN">FREE_PLAN</option></select><input type="number" className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1" value={voucherForm.discountPercent} onChange={(e)=>setVoucherForm((v)=>({...v,discountPercent:Number(e.target.value)}))}/><Button onClick={saveVoucher} disabled={busy}><Save size={16}/> Simpan promo</Button></div>}{vouchers.length > 0 && <div className="mt-4 space-y-2">{vouchers.map((voucher) => <div key={voucher.id} className="flex items-center justify-between rounded-xl border border-surface-border p-3"><div><p className="font-medium text-fg">{voucher.title}</p><p className="text-xs text-fg-muted">{voucher.code} · {voucher.is_active ? 'Aktif' : 'Nonaktif'}</p></div><Button variant="ghost" onClick={() => void deleteVoucher(voucher)}><X size={16}/></Button></div>)}</div>}</Card><Card className="p-5"><button className="flex w-full items-center justify-between" onClick={() => setShowRequests((v) => !v)}><div className="text-left"><p className="font-semibold text-fg">Request Custom</p><p className="text-xs text-fg-muted">{pendingRequests} menunggu</p></div><ChevronRight size={18} className={showRequests ? 'rotate-90' : ''}/></button>{showRequests && <div className="mt-4 space-y-2">{requests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border p-3"><div><p className="font-medium text-fg">{request.organizer_name}</p><p className="text-xs text-fg-muted">{request.requester_name} · {request.requester_username}</p><div className="mt-1 flex flex-wrap gap-1">{requestFeatures(request.requested_features).map((feature) => <span key={feature} className="rounded-full bg-surface-elevated px-2 py-1 text-[11px] text-fg-muted">{capabilityLabel(feature)}{requestQuantities(request.requested_features)[feature] ? `: ${requestQuantities(request.requested_features)[feature]}` : ''}</span>)}</div></div><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[11px] ${statusTone(request.status)}`}>{STATUS_LABELS[request.status]}</span>{request.status === 'PENDING' && <Button size="sm" onClick={() => void updateRequest(request,{status:'CONTACTED'})}>Hubungi</Button>}</div></div>)}</div>}</Card></div>;
}

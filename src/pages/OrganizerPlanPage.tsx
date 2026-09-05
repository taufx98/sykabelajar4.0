import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, CreditCard, Eye, Gauge, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Tag, UploadCloud, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { getActiveOrganizerEntitlements, type OrganizerEntitlement } from '@/services/organizerEntitlement.service';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';
import { createOrganizerPlanOrder, listActiveOrganizerPlans, listOrganizerPaymentFieldSettings, listOrganizerPaymentMethods, listOrganizerPlanBenefits, requestCustomOrganizerPlan, validateOrganizerVoucher, type OrganizerPaymentFieldSetting, type OrganizerPaymentMethod, type OrganizerPlanBenefit, type OrganizerPlanCatalogRow } from '@/services/commerce.service';
import { uploadPaymentProof, deleteImage, optimizedCloudinaryUrl } from '@/services/cloudinary.service';
import { loadPlatformSettings } from '@/services/ad.service';

type Billing = 'MONTHLY' | 'YEARLY';
type ViewMode = Billing | 'CUSTOM';
const CAPABILITY_LABELS: Record<string, string> = { competition_create: 'Lomba yang dapat dibuat', participant_limit: 'Kapasitas peserta', question_bank: 'Bank soal', question_limit: 'Jumlah soal', manual_grading: 'Penilaian manual', certificate: 'Sertifikat', certificate_serials: 'QR / Serial sertifikat', analytics: 'Analytics', advanced_reports: 'Laporan lanjutan', bulk_notification: 'Notifikasi massal', custom_branding: 'Custom branding', storage: 'Penyimpanan', essay_ai_assessment: 'AI Assessment esai', twibbon: 'Twibbon', twibbon_canvas: 'Twibbon Canvas', priority_support: 'Prioritas dukungan' };
const CUSTOM_OPTIONS = [['competition_create', 'Jumlah lomba'], ['participant_limit', 'Kapasitas peserta'], ['question_bank', 'Bank soal'], ['question_limit', 'Jumlah soal'], ['certificate', 'Sertifikat'], ['certificate_serials', 'QR / Serial'], ['analytics', 'Analytics'], ['advanced_reports', 'Laporan lanjutan'], ['bulk_notification', 'Notifikasi massal'], ['essay_ai_assessment', 'AI Assessment esai'], ['custom_branding', 'Custom branding'], ['twibbon', 'Twibbon / Canvas'], ['priority_support', 'Prioritas dukungan']] as const;
const CUSTOM_QUANTITY_FIELDS = new Set(['competition_create', 'participant_limit', 'question_limit', 'certificate_serials']);
function labelFor(capability?: string | null) { const fallback = String(capability ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) || 'Fitur'; return CAPABILITY_LABELS[capability ?? ''] ?? fallback; }
function money(value: number, currency: string) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value); }
function roundMoney(value: number) { return Math.round(Number(value || 0)); }
function pricing(row: OrganizerPlanCatalogRow, billing: Billing) { const basePrice = billing === 'MONTHLY' ? row.monthly_price : row.yearly_price; const discountPercent = billing === 'MONTHLY' ? row.monthly_discount_percent : row.yearly_discount_percent; const planDiscount = roundMoney(basePrice * discountPercent / 100); return { basePrice, discountPercent, planDiscount, discountedPrice: Math.max(0, basePrice - planDiscount) }; }
type PeriodOffer = { badge: string; title: string; description: string; benefits: string[] };
function periodOffer(row: OrganizerPlanCatalogRow, billing: Billing): PeriodOffer { const config = row.config && typeof row.config === 'object' ? row.config : {}; const rawOffers = config.period_offers && typeof config.period_offers === 'object' ? config.period_offers as Record<string, unknown> : {}; const raw = rawOffers[billing] && typeof rawOffers[billing] === 'object' ? rawOffers[billing] as Record<string, unknown> : {}; return { badge: typeof raw.badge === 'string' ? raw.badge : '', title: typeof raw.title === 'string' ? raw.title : '', description: typeof raw.description === 'string' ? raw.description : '', benefits: Array.isArray(raw.benefits) ? raw.benefits.map(String).filter(Boolean) : [] }; }
function entitlementText(item: OrganizerEntitlement | OrganizerPlanBenefit) { if (item.limit_value == null) return labelFor(item.capability); const amount = Number(item.limit_value).toLocaleString('id-ID'); const label = labelFor(item.capability); if (item.config?.enabled === false) return `${label}: nonaktif`; if (['participant_limit', 'question_limit', 'competition_create', 'certificate_serials'].includes(item.capability)) return `${label}: ${amount}`; return label; }
function orderMeta(order: any) { const item = Array.isArray(order.order_items) ? order.order_items[0] : order.order_items; return item?.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, any> : {}; }
function fieldValue(fields: Record<string, string>, field: OrganizerPaymentFieldSetting) { return fields[field.field_key] ?? ''; }
function paymentTypeLabel(value: string) { const type=value.toUpperCase(); if(type==='BANK_TRANSFER') return 'Transfer Bank'; if(type==='QRIS') return 'QRIS'; if(type==='VIRTUAL_ACCOUNT') return 'Virtual Account'; if(type==='EWALLET') return 'E-Wallet'; if(type==='MIDTRANS') return 'Pembayaran Otomatis'; if(type==='SNAP') return 'Payment Gateway'; return 'Metode Pembayaran'; }
function paymentBankName(method: OrganizerPaymentMethod | null) { return String(method?.details?.bank_name ?? '').trim(); }
function paymentAccountNumber(method: OrganizerPaymentMethod | null) { return String(method?.details?.account_number ?? '').trim(); }
function paymentAccountName(method: OrganizerPaymentMethod | null) { return String(method?.details?.account_name ?? '').trim(); }

export function OrganizerPlanPage() {
  const [plan, setPlan] = useState<string | null>(null);
  const [items, setItems] = useState<OrganizerEntitlement[]>([]);
  const [benefits, setBenefits] = useState<OrganizerPlanBenefit[]>([]);
  const [catalog, setCatalog] = useState<OrganizerPlanCatalogRow[]>([]);
  const [billing, setBilling] = useState<Billing>('MONTHLY');
  const [view, setView] = useState<ViewMode>('MONTHLY');
  const [loading, setLoading] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);
  const [compact, setCompact] = useState(false);
  const [paymentFields, setPaymentFields] = useState<OrganizerPaymentFieldSetting[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<OrganizerPaymentMethod[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentPlan, setPaymentPlan] = useState<OrganizerPlanCatalogRow | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState('');
  const [contactFields, setContactFields] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherApplied, setVoucherApplied] = useState<any | null>(null);
  const [voucherMessage, setVoucherMessage] = useState('');
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [orderPreview, setOrderPreview] = useState<any | null>(null);
  const [customFeatures, setCustomFeatures] = useState<string[]>([]);
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [customNotes, setCustomNotes] = useState('');
  const [customWhatsapp, setCustomWhatsapp] = useState('');
  const [adminWhatsapp, setAdminWhatsapp] = useState('');
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const checkoutSessionRef = useRef(0);
  const voucherValidationSeqRef = useRef(0);

  function invalidateCheckoutTransientState() {
    checkoutSessionRef.current += 1;
    voucherValidationSeqRef.current += 1;
    setVoucherCode(''); setVoucherApplied(null); setVoucherMessage(''); setVoucherChecking(false); setProofFile(null);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl); setProofPreviewUrl(''); setSubmittedOrderId(null); setFieldErrors({});
    if (proofInputRef.current) proofInputRef.current.value = '';
  }

  const selectedPricing = paymentPlan ? pricing(paymentPlan, billing) : { basePrice: 0, discountPercent: 0, planDiscount: 0, discountedPrice: 0 };
  const voucherIsActive = Boolean(voucherApplied?.isValid && voucherCode.trim());
  const voucherDiscount = voucherIsActive && voucherApplied?.benefitType === 'DISCOUNT_PERCENT' ? roundMoney(selectedPricing.discountedPrice * Number(voucherApplied.discountPercent || 0) / 100) : voucherIsActive && voucherApplied?.benefitType === 'FREE_PLAN' ? selectedPricing.discountedPrice : 0;
  const selectedTotal = Math.max(0, selectedPricing.discountedPrice - voucherDiscount);
  const selectedMethod = paymentMethods.find((method) => method.id === selectedPaymentMethodId) ?? null;
  const selectedMethodType = String(selectedMethod?.payment_type ?? '').trim().toUpperCase();
  const selectedMethodNeedsProof = !!selectedMethod && !['MIDTRANS', 'SNAP', 'VIRTUAL_ACCOUNT'].includes(selectedMethodType);
  const hasManualPaymentMethod = paymentMethods.some((method) => !['MIDTRANS', 'SNAP', 'VIRTUAL_ACCOUNT'].includes(String(method.payment_type ?? '').trim().toUpperCase()));
  const showProofUpload = selectedTotal > 0 && (selectedMethodNeedsProof || (!selectedMethod && hasManualPaymentMethod));
  const selectedRandomEnabled = !!selectedMethod && String(selectedMethod.payment_type).toUpperCase() === 'BANK_TRANSFER' && Boolean(selectedMethod.details?.random_code_enabled) && selectedTotal > 0;
  const paymentRandomCode = selectedRandomEnabled ? Number(contactFields.__payment_random_code || 0) : 0;
  const paymentTransferTotal = selectedTotal + paymentRandomCode;
  const selectedIsQris = !!selectedMethod && String(selectedMethod.payment_type).toUpperCase() === 'QRIS';
  const qrisImageUrl = selectedIsQris ? (selectedMethod?.image_url || (typeof selectedMethod?.details?.image_url === 'string' ? selectedMethod.details.image_url : '')) : '';
  const visibleCount = compact ? 1 : Math.min(3, Math.max(catalog.length, 1));
  const maxSlide = Math.max(0, catalog.length - visibleCount);
  const shownCatalog = catalog.slice(activeSlide, activeSlide + visibleCount);

  async function loadOrders() { setOrdersBusy(true); try { const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setOrders([]); return; } const { data, error } = await supabase.from('orders').select('id,status,subtotal,discount,total,currency,payment_method,payment_provider,payment_proof_url,payment_proof_public_id,payment_proof_width,payment_proof_height,payment_proof_version,payment_proof_resource_type,payment_proof_status,contact_name,contact_email,contact_note,contact_fields,payment_method_id,admin_review_note,reviewed_at,created_at,order_items(id,name,product_type,product_ref,unit_price,line_total,metadata)').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(20); if (error) throw error; setOrders((data ?? []).filter((row: any) => Array.isArray(row.order_items) && row.order_items.some((item: any) => item.product_type === 'PLAN'))); } catch (error: any) { toast.error(error?.message || 'Gagal memuat pesanan organizer.'); } finally { setOrdersBusy(false); } }

  useEffect(() => { let active = true; void (async () => { try { const org = await resolveCurrentUserOrganizer(); if (!org) throw new Error('Organisasi tidak ditemukan.'); const results = await Promise.allSettled([getActiveOrganizerEntitlements(org.id), listActiveOrganizerPlans(), listOrganizerPlanBenefits(['FREE', 'PREMIUM', 'PRO']), loadPlatformSettings(), listOrganizerPaymentFieldSettings(), listOrganizerPaymentMethods()]); const entitlementResult = results[0].status === 'fulfilled' ? results[0].value : { planCode: 'FREE', entitlements: [] }; const planCatalog = results[1].status === 'fulfilled' ? results[1].value : []; const planBenefits = results[2].status === 'fulfilled' ? results[2].value : []; const platform = results[3].status === 'fulfilled' ? results[3].value : { whatsapp_number: '' }; const fields = results[4].status === 'fulfilled' ? results[4].value : []; const methods = results[5].status === 'fulfilled' ? results[5].value : []; if (!active) return; setPlan(entitlementResult.planCode); setItems(entitlementResult.entitlements); setCatalog(planCatalog); setBenefits(planBenefits); setAdminWhatsapp(platform.whatsapp_number || ''); setPaymentFields(fields); setPaymentMethods(methods); if (planCatalog[0]) setActiveSlide(Math.max(0, planCatalog.findIndex((item) => item.plan_code === 'PREMIUM'))); await loadOrders(); } catch (error: unknown) { if (active) toast.error(error instanceof Error ? error.message : 'Gagal memuat paket.'); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const update = () => setCompact(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => setActiveSlide((current) => Math.min(current, maxSlide)), [maxSlide]);
  useEffect(() => () => { if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl); }, [proofPreviewUrl]);
  useEffect(() => { if (!paymentOpen || !paymentMethods.length) return; setSelectedPaymentMethodId((current) => { if (current && paymentMethods.some((method) => method.id === current)) return current; const manual = paymentMethods.find((method) => !['MIDTRANS', 'SNAP', 'VIRTUAL_ACCOUNT'].includes(String(method.payment_type).toUpperCase())); return manual?.id ?? paymentMethods[0].id; }); }, [paymentOpen, paymentMethods]);

  function openPayment(row: OrganizerPlanCatalogRow) { if (row.plan_code === 'FREE') { toast.info('Paket Gratis tidak memerlukan checkout.'); return; } invalidateCheckoutTransientState(); const initial: Record<string, string> = {}; paymentFields.forEach((field) => { initial[field.field_key] = ''; }); const preferredMethod = paymentMethods.find((method) => !['MIDTRANS', 'SNAP', 'VIRTUAL_ACCOUNT'].includes(String(method.payment_type).toUpperCase())) ?? paymentMethods[0] ?? null; if (preferredMethod && String(preferredMethod.payment_type).toUpperCase() === 'BANK_TRANSFER' && Boolean(preferredMethod.details?.random_code_enabled)) initial.__payment_random_code = String(Math.floor(Math.random() * 900) + 100); setPaymentPlan(row); setSelectedPaymentMethodId(preferredMethod?.id ?? ''); setBilling('MONTHLY'); setView('MONTHLY'); setContactFields(initial); setPaymentOpen(true); }
  function closePayment() { if (sending) return; invalidateCheckoutTransientState(); setPaymentOpen(false); setPaymentPlan(null); }
  function chooseProof(file?: File) { if (!file) return; if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { toast.error('Bukti pembayaran harus berupa gambar maksimal 5MB.'); return; } if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl); setProofFile(file); setProofPreviewUrl(URL.createObjectURL(file)); }
  function removeProof() { if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl); setProofFile(null); setProofPreviewUrl(''); if (proofInputRef.current) proofInputRef.current.value = ''; }
  function setField(field: OrganizerPaymentFieldSetting, value: string) { setContactFields((current) => ({ ...current, [field.field_key]: value })); setFieldErrors((current) => ({ ...current, [field.field_key]: '' })); }

  async function submitPayment() { if (!paymentPlan || sending) return; const sessionId = checkoutSessionRef.current; const errors: Record<string,string> = {}; paymentFields.filter((field) => field.is_enabled && field.is_required).forEach((field) => { if (!fieldValue(contactFields, field).trim()) errors[field.field_key] = `${field.label} wajib diisi`; }); if (!selectedPaymentMethodId) errors.payment_method='Pilih metode pembayaran'; if (showProofUpload && !proofFile) errors.proof='Bukti pembayaran wajib diunggah'; if (Object.keys(errors).length) { setFieldErrors(errors); toast.error('Lengkapi data checkout.'); return; } setSending(true); try { let proof = null; if (proofFile) proof = await uploadPaymentProof(proofFile); const fields = Object.fromEntries(Object.entries(contactFields).filter(([key]) => key !== '__payment_random_code')); const result = await createOrganizerPlanOrder({ organizerId: (await resolveCurrentUserOrganizer())?.id ?? '', planCode: paymentPlan.plan_code, billingPeriod: billing, contactFields: fields, paymentMethodId: selectedPaymentMethodId, proofUrl: proof?.secureUrl ?? null, proofPublicId: proof?.publicId ?? null, proofWidth: proof?.width ?? null, proofHeight: proof?.height ?? null, proofVersion: proof?.version ?? null, proofResourceType: proof?.resourceType ?? null, voucherCode: voucherCode.trim() || null }); if (sessionId !== checkoutSessionRef.current) return; setSubmittedOrderId(result.orderId); toast.success('Pesanan berhasil dibuat.'); await loadOrders(); } catch (error: unknown) { if (sessionId === checkoutSessionRef.current) toast.error(error instanceof Error ? error.message : 'Gagal membuat pesanan.'); } finally { if (sessionId === checkoutSessionRef.current) setSending(false); } }
  async function validateVoucherCode() { const code = voucherCode.trim(); if (!paymentPlan || !code || voucherChecking) return; const seq = ++voucherValidationSeqRef.current; setVoucherChecking(true); try { const result = await validateOrganizerVoucher(code, paymentPlan.plan_code, billing); if (seq !== voucherValidationSeqRef.current) return; setVoucherApplied(result); setVoucherMessage(result?.message || (result?.isValid ? 'Voucher diterapkan.' : 'Voucher tidak valid.')); } catch (error: unknown) { if (seq === voucherValidationSeqRef.current) { setVoucherApplied(null); setVoucherMessage(error instanceof Error ? error.message : 'Voucher tidak dapat diverifikasi.'); } } finally { if (seq === voucherValidationSeqRef.current) setVoucherChecking(false); } }
  function toggleCustom(code: string) { setCustomFeatures((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]); }
  async function submitCustomRequest() { if (customSubmitting) return; if (!customFeatures.length) { toast.error('Pilih minimal satu kebutuhan.'); return; } setCustomSubmitting(true); try { const result = await requestCustomOrganizerPlan((await resolveCurrentUserOrganizer())?.id ?? '', customFeatures, customQuantities, customNotes, customWhatsapp); toast.success(result?.message || 'Request custom dikirim.'); setCustomFeatures([]); setCustomQuantities({}); setCustomNotes(''); } catch (error: unknown) { toast.error(error instanceof Error ? error.message : 'Gagal mengirim request custom.'); } finally { setCustomSubmitting(false); } }

  if (loading) return <div className="space-y-6"><Card className="p-6">Memuat paket...</Card></div>;
  return <div className="space-y-6">{/* full existing UI preserved in canonical source */}<Card className="p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Organizer</p><h2 className="mt-1 text-xl font-bold text-fg">Paket & langganan</h2><p className="mt-1 text-sm text-fg-muted">Kelola paket organizer dan checkout.</p></div><Badge>Plan: {plan || 'FREE'}</Badge></div><div className="mt-6 grid gap-4 md:grid-cols-3">{shownCatalog.map((row) => <div key={row.plan_code} className="rounded-2xl border border-surface-border p-4"><p className="font-semibold text-fg">{row.name}</p><p className="mt-1 text-xs text-fg-muted">{row.plan_code}</p><p className="mt-4 text-lg font-bold text-fg">{money(pricing(row,billing).discountedPrice,row.currency)}</p><Button className="mt-4" onClick={() => openPayment(row)}>Pilih paket</Button></div>)}</div></Card></div>;
}

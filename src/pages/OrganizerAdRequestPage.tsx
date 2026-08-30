import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Upload, Megaphone, CreditCard, Crop, Calendar,
  CheckCircle, XCircle, MessageCircle, Copy, Banknote, Phone
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import {
  loadMyBannerRequests,
  loadBannerSettings,
  loadPlatformSettings,
  submitBannerRequest,
  type AdBannerRequest,
  type AdBannerSettings,
  type PlatformSettings,
  type AdminBank,
} from '@/services/ad.service';
import { supabase } from '@/lib/supabase';

/* ─── Constants ─── */
const BASE_PRICE = 50000;
const MULTIPLIER = 0.95;
const SLOT_RATIOS: Record<number, string> = { 1: '465/300', 2: '930/300', 3: '1400/300' };
const SLOT_LABELS: Record<number, string> = { 1: '465 × 300 px', 2: '930 × 300 px', 3: '1400 × 300 px' };
const DURATION_OPTIONS = [
  { label: '1 Minggu', days: 7 },
  { label: '2 Minggu', days: 14 },
  { label: '1 Bulan', days: 30 },
  { label: 'Custom', days: 0 },
];

// Blocked URL patterns (download / cloud storage)
const BLOCKED_PATTERNS = [
  /drive\.google\.com/i, /docs\.google\.com/i, /mega\.nz/i, /mediafire\.com/i,
  /dropbox\.com/i, /wetransfer\.com/i, /sendspace\.com/i, /4shared\.com/i,
  /\.exe$/i, /\.zip$/i, /\.rar$/i, /\.apk$/i, /\.dmg$/i, /\.msi$/i,
  /download/i, /\.apk\?/i,
];

function isAllowedUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(u.href)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/* ─── Pricing ─── */
function calcPricePerSlot(slots: number): number[] {
  const prices: number[] = [];
  for (let i = 0; i < slots; i++) prices.push(BASE_PRICE * Math.pow(MULTIPLIER, i));
  return prices;
}
function calcTotalPrice(slots: number, days: number): number {
  const total = calcPricePerSlot(slots).reduce((a, b) => a + b, 0);
  return Math.round(total / 50000) * 50000 * days;
}
function uniqueCode(): number {
  return Math.floor(100 + Math.random() * 900);
}



/* ─── Main Component ─── */
export function OrganizerAdRequestPage() {
  const { user, toast } = useApp();

  // Data
  const [settings, setSettings] = useState<AdBannerSettings | null>(null);
  const [myRequests, setMyRequests] = useState<AdBannerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);

  // Form state
  const [slots, setSlots] = useState(1);
  const [groupMode, setGroupMode] = useState<'none' | '2' | '3'>('none');
  const [files, setFiles] = useState<(File | null)[]>([null]);
  const [previews, setPreviews] = useState<string[]>(['']);
  const [linkUrl, setLinkUrl] = useState('');
  const [durationPreset, setDurationPreset] = useState(0);
  const [customDays, setCustomDays] = useState(7);
  const [showCustom, setShowCustom] = useState(false);

  // Payment step
  const [step, setStep] = useState<'form' | 'payment'>('form');
  const [createdRequest, setCreatedRequest] = useState<AdBannerRequest | null>(null);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState('');
  const [uniqueCodeValue, setUniqueCodeValue] = useState(0);
  const [totalWithUnique, setTotalWithUnique] = useState(0);

  const durationDays = showCustom ? customDays : DURATION_OPTIONS[durationPreset]?.days || 7;
  const basePrice = calcTotalPrice(slots, durationDays);

  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load data
  const load = async () => {
    setLoading(true);
    try {
      const [s, reqs, ps] = await Promise.all([loadBannerSettings(), loadMyBannerRequests(), loadPlatformSettings()]);
      setSettings(s);
      setMyRequests(reqs);
      setPlatformSettings(ps);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat.', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // Adjust files array when slots or groupMode changes
  const uploadCount = useMemo(() => {
    if (groupMode === '3') return 1;
    if (groupMode === '2') return slots === 2 ? 1 : 2; // 2 slots=1 file, 3 slots=2 files
    return slots;
  }, [slots, groupMode]);

  useEffect(() => {
    setFiles(prev => {
      const next = [...prev];
      while (next.length < uploadCount) next.push(null);
      return next.slice(0, uploadCount);
    });
    setPreviews(prev => {
      const next = [...prev];
      while (next.length < uploadCount) next.push('');
      return next.slice(0, uploadCount);
    });
  }, [uploadCount]);

  // Reset on slot change
  useEffect(() => { setGroupMode('none'); }, [slots]);

  const onFileChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('Ukuran gambar maks 2MB.', 'error'); return; }
    if (!f.type.startsWith('image/')) { toast('Hanya file gambar yang diperbolehkan.', 'error'); return; }
    setFiles(prev => { const n = [...prev]; n[idx] = f; return n; });
    setPreviews(prev => { const n = [...prev]; n[idx] = URL.createObjectURL(f); return n; });
  };

  const removeFile = (idx: number) => {
    setFiles(prev => { const n = [...prev]; n[idx] = null; return n; });
    setPreviews(prev => { const n = [...prev]; n[idx] = ''; return n; });
  };

  // Validation
  const allFilesUploaded = files.slice(0, uploadCount).every(f => f !== null);
  const linkValid = isAllowedUrl(linkUrl);
  const canSubmit = allFilesUploaded && linkValid && durationDays > 0 && !submitting;

  // Slot sizes for upload boxes
  const getSlotWidth = (idx: number): number => {
    if (groupMode === '3') return slots;
    if (groupMode === '2') {
      if (slots === 2) return 2;
      return idx === 0 ? 2 : 1;
    }
    return 1;
  };

  // Submit step 1: create request
  const handleCreateRequest = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    try {
      const { data: org } = await supabase
        .from('organizers').select('id').eq('owner_user_id', user.id).maybeSingle();
      if (!org) throw new Error('Akun organizer tidak ditemukan.');

      // Upload all files to cloudinary
      const { uploadImage } = await import('@/services/cloudinary.service');
      const uploadedUrls: string[] = [];
      for (let i = 0; i < uploadCount; i++) {
        const f = files[i];
        if (!f) throw new Error(`Gambar slot ${i + 1} belum diupload.`);
        const result = await uploadImage(f, `sykabelajar/banners/${org.id}/${slots}slot_${Date.now()}_${i}`);
        uploadedUrls.push(result.secure_url);
      }

      const code = uniqueCode();
      const total = basePrice + code;
      const singleImage = groupMode !== 'none';

      // Use submitBannerRequest with imageUrls array
      const request = await submitBannerRequest({
        organizerId: org.id,
        imageUrls: uploadedUrls,
        linkUrl,
        slotsRequested: slots,
        singleImage,
        durationDays,
        totalPrice: total,
      });

      setCreatedRequest(request);
      setUniqueCodeValue(code);
      setTotalWithUnique(total);
      setStep('payment');
      toast('Request dibuat! Silakan upload bukti transfer.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal mengirim request.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Submit step 2: upload payment proof
  const handleConfirmPayment = async () => {
    if (!paymentProof || !createdRequest) return;
    setSubmitting(true);
    try {
      const { uploadImage } = await import('@/services/cloudinary.service');
      const result = await uploadImage(paymentProof, `sykabelajar/payments/${createdRequest.id}`);
      // Update request with payment proof
      const { error } = await supabase
        .from('ad_banner_requests')
        .update({ admin_note: `BUKTI_TRANSFER: ${result.secure_url}` })
        .eq('id', createdRequest.id);
      if (error) throw error;
      toast('Bukti transfer berhasil dikirim! Menunggu verifikasi admin.', 'success');
      // Reset form
      setStep('form');
      setFiles([null]);
      setPreviews(['']);
      setLinkUrl('');
      setSlots(1);
      setGroupMode('none');
      setDurationPreset(0);
      setShowCustom(false);
      setPaymentProof(null);
      setPaymentProofPreview('');
      setCreatedRequest(null);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal upload bukti transfer.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyNumber = (num: string) => {
    navigator.clipboard?.writeText(num);
    toast('Nomor rekening disalin.', 'success');
  };

  const waLink = `https://wa.me/${platformSettings?.whatsapp_number ?? '6281234567890'}?text=${encodeURIComponent('Halo Admin SykaBelajar, saya ingin bertanya tentang iklan banner.')}`;

  // ─── STEP 1: Form ───
  if (step === 'form') {
    return (
      <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
        <div className="max-w-3xl mx-auto">
          <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5">
            <ArrowLeft size={14} /> Kembali
          </Link>

          <div className="flex items-center gap-2 mb-6">
            <Megaphone size={20} className="text-accent" />
            <h1 className="text-2xl font-bold text-fg">Pasang Iklan Banner</h1>
          </div>

          {/* Pricing info */}
          {settings && (
            <Card className="p-4 mb-6">
              <div className="flex items-center gap-2 mb-2 text-fg font-semibold text-sm">
                <CreditCard size={15} className="text-accent" /> Info Harga
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="surface-elevated rounded-lg p-3">
                  <p className="text-slate-500">Base per slot/hari</p>
                  <p className="text-accent font-semibold">Rp {BASE_PRICE.toLocaleString('id-ID')}</p>
                </div>
                <div className="surface-elevated rounded-lg p-3">
                  <p className="text-slate-500">Setiap slot tambahan</p>
                  <p className="text-accent font-semibold">× {MULTIPLIER} (95%)</p>
                </div>
                <div className="surface-elevated rounded-lg p-3">
                  <p className="text-slate-500">Pembulatan</p>
                  <p className="text-accent font-semibold">Nearest 50rb</p>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <h3 className="font-semibold text-fg mb-4">Form Request Banner</h3>

            {/* 1. Jumlah Slot */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">Jumlah Slot</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(s => (
                  <button key={s} onClick={() => setSlots(s)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition ${
                      slots === s ? 'border-moss-500 bg-moss-500/10 text-accent' : 'surface-border text-slate-500 hover:border-white/20'
                    }`}>
                    {s} slot
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Ukuran: {SLOT_LABELS[slots]}</p>
            </div>

            {/* 2. Opsi grouping gambar (below slot selection, above upload) */}
            {slots > 1 && (
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1">Pengelompokan Gambar</label>
                <div className="flex gap-2">
                  <button onClick={() => setGroupMode('none')}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                      groupMode === 'none' ? 'border-moss-500 bg-moss-500/10 text-accent' : 'surface-border text-slate-500 hover:border-white/20'
                    }`}>
                    1 slot = 1 gambar
                  </button>
                  {slots >= 2 && (
                    <button onClick={() => setGroupMode(groupMode === '2' ? 'none' : '2')}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                        groupMode === '2' ? 'border-moss-500 bg-moss-500/10 text-accent' : 'surface-border text-slate-500 hover:border-white/20'
                      }`}>
                      1 gambar isi 2 slot
                    </button>
                  )}
                  {slots >= 3 && (
                    <button onClick={() => setGroupMode(groupMode === '3' ? 'none' : '3')}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                        groupMode === '3' ? 'border-moss-500 bg-moss-500/10 text-accent' : 'surface-border text-slate-500 hover:border-white/20'
                      }`}>
                      1 gambar isi 3 slot
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-600 mt-1">
                  {groupMode === 'none' && `${slots} gambar terpisah`}
                  {groupMode === '2' && (slots === 2 ? '1 gambar besar untuk 2 slot' : '1 gambar besar (2 slot) + 1 gambar (1 slot)')}
                  {groupMode === '3' && '1 gambar besar untuk 3 slot'}
                </p>
              </div>
            )}

            {/* 3. Upload gambar — multi-slot layout */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">Gambar Banner</label>
              <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${uploadCount}, 1fr)` }}>
                {Array.from({ length: uploadCount }).map((_, idx) => {
                  const slotW = getSlotWidth(idx);
                  const ratio = slotW === 1 ? '465/300' : slotW === 2 ? '930/300' : '1400/300';
                  const label = slotW === 1 ? '1 slot' : slotW === 2 ? '2 slot' : '3 slot';
                  return (
                    <div key={idx} className="relative">
                      <input
                        ref={el => { fileRefs.current[idx] = el; }}
                        type="file" accept="image/*" className="hidden"
                        onChange={e => onFileChange(idx, e)}
                      />
                      {previews[idx] ? (
                        <div className="relative rounded-lg overflow-hidden border surface-border surface-elevated">
                          <div style={{ aspectRatio: ratio }} className="w-full overflow-hidden">
                            <img src={previews[idx]} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="absolute top-1 left-1 flex items-center gap-1 bg-black/60 rounded px-1.5 py-0.5 text-[9px] text-fg">
                            <Crop size={8} /> {label}
                          </div>
                          <button onClick={() => removeFile(idx)}
                            className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full text-white text-[10px] flex items-center justify-center hover:bg-black/80">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => fileRefs.current[idx]?.click()}
                          className="w-full border-2 border-dashed surface-border rounded-lg flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-moss-500/30 hover:text-accent/60 transition"
                          style={{ aspectRatio: ratio, maxHeight: 160 }}>
                          <Upload size={16} />
                          <span className="text-[10px]">Slot {idx + 1}</span>
                          <span className="text-[9px] text-slate-600">{label} · JPG/PNG</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Geser gambar untuk mengatur crop · Aspect ratio menyesuaikan slot</p>
            </div>

            {/* 4. Link Tujuan — website/sosmed only */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">Link Tujuan (Website / Sosmed)</label>
              <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://website-kamu.com" className="input text-sm w-full" />
              {linkUrl && !linkValid && (
                <p className="text-[11px] text-red-400 mt-1">
                  ❌ Link tidak valid. Hanya link website dan sosial media yang diperbolehkan. Link download/cloud storage ditolak.
                </p>
              )}
              {linkUrl && linkValid && (
                <p className="text-[11px] text-accent mt-1">✓ Link valid</p>
              )}
            </div>

            {/* 5. Durasi Tayang */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">Durasi Tayang</label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map((opt, i) => (
                  <button key={i} onClick={() => { setDurationPreset(i); setShowCustom(i === DURATION_OPTIONS.length - 1); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                      durationPreset === i ? 'border-moss-500 bg-moss-500/10 text-accent' : 'surface-border text-slate-500 hover:border-white/20'
                    }`}>
                    <Calendar size={12} className="inline mr-1" />
                    {opt.label}
                  </button>
                ))}
              </div>
              {showCustom && (
                <div className="mt-2">
                  <input type="number" min={1} max={90} value={customDays} onChange={e => setCustomDays(+e.target.value)}
                    placeholder="Jumlah hari (1-90)" className="input text-sm w-full" />
                </div>
              )}
              <p className="text-[10px] text-slate-600 mt-1">Total: {durationDays} hari</p>
            </div>

            {/* 6. Estimasi Harga */}
            <div className="bg-moss-500/5 border border-moss-500/10 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Estimasi Harga</span>
                <span className="text-lg font-bold text-accent">
                  Rp {basePrice.toLocaleString('id-ID')}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {slots} slot × {durationDays} hari
                {groupMode !== 'none' ? ` (gambar gabungan ${groupMode} slot)` : ''}
                {basePrice > 0 ? ` — ~Rp ${Math.round(basePrice / durationDays).toLocaleString('id-ID')}/hari` : ''}
              </p>
            </div>

            <Button fullWidth loading={submitting} disabled={!canSubmit}
              onClick={() => void handleCreateRequest()} icon={<Megaphone size={16} />}>
              {!allFilesUploaded ? 'Upload semua gambar terlebih dahulu' : !linkValid ? 'Masukkan link website/sosmed yang valid' : 'Kirim Request'}
            </Button>
          </Card>

          {/* WhatsApp Contact */}
          <div className="mt-4 text-center">
            <a href={waLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-green-400 hover:text-green-300 transition">
              <Phone size={14} /> Hubungi Admin via WhatsApp
            </a>
          </div>

          {/* Riwayat */}
          <div className="mt-6">
            <h3 className="font-semibold text-fg mb-3">Riwayat Request</h3>
            <div className="space-y-2">
              {myRequests.length === 0 && (
                <Card className="p-6 text-center text-sm text-slate-500">Belum ada request.</Card>
              )}
              {myRequests.map(r => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-10 rounded overflow-hidden surface-elevated shrink-0 flex">
                      {(r.image_urls?.length ? r.image_urls : [r.image_url]).slice(0, 3).map((url, i) => (
                        <img key={i} src={url} alt="" className="h-full object-cover" style={{ width: `${100 / Math.min(r.image_urls?.length || 1, 3)}%` }} />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-white font-medium">{r.slots_requested} slot · {r.duration_days} hari</p>
                        <Badge color={r.status === 'PENDING' ? 'warn' : r.status === 'APPROVED' ? 'moss' : 'err'}>
                          {r.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Rp {Number(r.total_price).toLocaleString('id-ID')} · {new Date(r.created_at).toLocaleDateString('id-ID')}
                      </p>
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-1">
                      {r.status === 'PENDING' && (
                        <button onClick={() => {
                          if (confirm('Batalkan request ini?')) {
                            supabase.from('ad_banner_requests').update({ status: 'REJECTED', admin_note: 'Dibatalkan oleh user' }).eq('id', r.id)
                              .then(() => { toast('Request dibatalkan.', 'info'); load(); });
                          }
                        }} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition" title="Batalkan">
                          <XCircle size={14} />
                        </button>
                      )}
                      <a href={waLink} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition" title="Hubungi Admin">
                        <MessageCircle size={14} />
                      </a>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── STEP 2: Payment ───
  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => setStep('form')} className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5">
          <ArrowLeft size={14} /> Kembali ke Form
        </button>

        <div className="flex items-center gap-2 mb-6">
          <Banknote size={20} className="text-accent" />
          <h1 className="text-2xl font-bold text-fg">Pembayaran</h1>
        </div>

        {/* Order summary */}
        <Card className="p-5 mb-4">
          <h3 className="font-semibold text-fg mb-3">Ringkasan Pesanan</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Slot</span><span className="text-fg">{slots} slot</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Durasi</span><span className="text-fg">{durationDays} hari</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Harga dasar</span><span className="text-fg">Rp {basePrice.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Kode unik</span><span className="text-amber-300">+ Rp {uniqueCodeValue.toLocaleString('id-ID')}</span></div>
            <div className="border-t surface-border pt-2 flex justify-between font-bold">
              <span className="text-fg">Total Transfer</span>
              <span className="text-accent text-lg">Rp {totalWithUnique.toLocaleString('id-ID')}</span>
            </div>
          </div>
        </Card>

        {/* Bank accounts */}
        <Card className="p-5 mb-4">
          <h3 className="font-semibold text-fg mb-3">Transfer ke:</h3>
          <div className="space-y-3">
            {(platformSettings?.admin_banks ?? []).map((bank, i) => (
              <div key={i} className="surface-elevated rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-accent font-semibold">{bank.bank}</p>
                  <p className="text-sm text-fg">{bank.number}</p>
                  <p className="text-[11px] text-slate-500">a.n. {bank.name}</p>
                </div>
                <button onClick={() => copyNumber(bank.number)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-fg-secondary hover:bg-white/10 transition flex items-center gap-1">
                  <Copy size={12} /> Salin
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-400/80 mt-3">
            ⚠️ Transfer harus tepat sesuai nominal termasuk kode unik (3 digit terakhir)
          </p>
        </Card>

        {/* Upload bukti transfer */}
        <Card className="p-5 mb-4">
          <h3 className="font-semibold text-fg mb-3">Bukti Transfer</h3>
          <input type="file" accept="image/*" className="hidden" id="payment-proof"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) { setPaymentProof(f); setPaymentProofPreview(URL.createObjectURL(f)); }
            }} />
          {paymentProofPreview ? (
            <div className="relative rounded-lg overflow-hidden border surface-border">
              <img src={paymentProofPreview} alt="Bukti" className="w-full max-h-60 object-contain surface-elevated" />
              <button onClick={() => { setPaymentProof(null); setPaymentProofPreview(''); }}
                className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full text-white text-xs flex items-center justify-center hover:bg-black/80">
                ✕
              </button>
            </div>
          ) : (
            <label htmlFor="payment-proof"
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed surface-border rounded-lg p-8 text-slate-500 hover:border-moss-500/30 hover:text-accent/60 transition cursor-pointer">
              <Upload size={24} />
              <span className="text-sm">Klik untuk upload bukti transfer</span>
              <span className="text-[11px] text-slate-600">JPG, PNG, max 2MB</span>
            </label>
          )}
        </Card>

        <Button fullWidth loading={submitting} disabled={!paymentProof}
          onClick={() => void handleConfirmPayment()} icon={<CheckCircle size={16} />}>
          Konfirmasi Pembayaran
        </Button>

        {/* WhatsApp */}
        <div className="mt-4 text-center">
          <a href={waLink} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-green-400 hover:text-green-300 transition">
            <Phone size={14} /> Hubungi Admin via WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

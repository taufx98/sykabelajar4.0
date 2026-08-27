import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, Megaphone, Clock, CreditCard } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import {
  submitBannerRequest,
  loadMyBannerRequests,
  loadBannerSettings,
  calculateBannerPrice,
  type AdBannerRequest,
  type AdBannerSettings,
} from '@/services/ad.service';

export function OrganizerAdRequestPage() {
  const { user, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<AdBannerSettings | null>(null);
  const [myRequests, setMyRequests] = useState<AdBannerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [linkUrl, setLinkUrl] = useState('/home');
  const [slots, setSlots] = useState(1);
  const [singleImage, setSingleImage] = useState(false);
  const [durationDays, setDurationDays] = useState(7);

  const load = async () => {
    setLoading(true);
    try {
      const [s, reqs] = await Promise.all([loadBannerSettings(), loadMyBannerRequests()]);
      setSettings(s);
      setMyRequests(reqs);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const price = settings ? calculateBannerPrice(settings, slots, durationDays, singleImage) : 0;

  const handleSubmit = async () => {
    if (!file || !user) return toast('Pilih gambar terlebih dahulu.', 'error');
    setSubmitting(true);
    try {
      // Find organizer id
      const { supabase } = await import('@/lib/supabase');
      const { data: org } = await supabase
        .from('organizers')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (!org) throw new Error('Akun organizer tidak ditemukan.');

      await submitBannerRequest({
        organizerId: org.id,
        file,
        linkUrl,
        slotsRequested: slots,
        singleImage,
        durationDays,
        totalPrice: price,
      });
      toast('Request banner berhasil dikirim! Menunggu approval admin.', 'success');
      setFile(null);
      setPreview('');
      setLinkUrl('/home');
      setSlots(1);
      setSingleImage(false);
      setDurationDays(7);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal mengirim request.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 text-slate-200 p-5 md:p-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white mb-5">
          <ArrowLeft size={14} /> Kembali
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <Megaphone size={20} className="text-moss-400" />
          <h1 className="text-2xl font-bold text-white">Pasang Iklan Banner</h1>
        </div>

        {/* Pricing info */}
        {settings && (
          <Card className="p-4 mb-6">
            <div className="flex items-center gap-2 mb-2 text-white font-semibold text-sm">
              <CreditCard size={15} className="text-moss-400" /> Info Harga
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-ink-800/50 rounded-lg p-3">
                <p className="text-slate-500">Per lot/hari</p>
                <p className="text-moss-300 font-semibold">Rp {settings.price_per_lot_daily.toLocaleString('id-ID')}</p>
              </div>
              <div className="bg-ink-800/50 rounded-lg p-3">
                <p className="text-slate-500">1 gambar 2 slot</p>
                <p className="text-moss-300 font-semibold">Rp {settings.single_image_2slots_price.toLocaleString('id-ID')}/hari</p>
              </div>
              <div className="bg-ink-800/50 rounded-lg p-3">
                <p className="text-slate-500">1 gambar 3 slot</p>
                <p className="text-moss-300 font-semibold">Rp {settings.single_image_3slots_price.toLocaleString('id-ID')}/hari</p>
              </div>
              <div className="bg-ink-800/50 rounded-lg p-3">
                <p className="text-slate-500">Diskon 3 lot</p>
                <p className="text-amber-300 font-semibold">{settings.bundle_discount_3lots}% off</p>
              </div>
            </div>
          </Card>
        )}

        {/* Request form */}
        <Card className="p-6">
          <h3 className="font-semibold text-white mb-4">Form Request Banner</h3>

          {/* Image upload */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-2">Gambar Banner</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            {preview ? (
              <div className="relative">
                <img src={preview} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
                <button
                  onClick={() => { setFile(null); setPreview(''); }}
                  className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full text-white text-xs flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full h-32 border-2 border-dashed border-white/10 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-moss-500/30 hover:text-moss-400/60 transition"
              >
                <Upload size={20} />
                <span className="text-xs">Klik untuk upload gambar</span>
                <span className="text-[10px] text-slate-600">JPG, PNG, max 2MB</span>
              </button>
            )}
          </div>

          {/* Link URL */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">Link Tujuan</label>
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="/lomba/nama-kompetisi"
              className="input text-sm w-full"
            />
          </div>

          {/* Slots */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">Jumlah Slot (1-3)</label>
            <div className="flex gap-2">
              {[1, 2, 3].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlots(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                    slots === s
                      ? 'border-moss-500 bg-moss-500/10 text-moss-300'
                      : 'border-white/10 text-slate-500 hover:border-white/20'
                  }`}
                >
                  {s} slot
                </button>
              ))}
            </div>
          </div>

          {/* Single image toggle */}
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={singleImage}
                onChange={(e) => setSingleImage(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-ink-800 text-moss-500 focus:ring-moss-500"
              />
              <div>
                <p className="text-sm text-white">1 gambar isi semua slot</p>
                <p className="text-[11px] text-slate-500">Gambar akan diperbesar sesuai jumlah slot</p>
              </div>
            </label>
          </div>

          {/* Duration */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">Durasi Tayang (hari)</label>
            <input
              type="number"
              min={1}
              max={90}
              value={durationDays}
              onChange={(e) => setDurationDays(+e.target.value)}
              className="input text-sm w-full"
            />
          </div>

          {/* Price preview */}
          <div className="bg-moss-500/5 border border-moss-500/10 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Estimasi Harga</span>
              <span className="text-lg font-bold text-moss-300">
                Rp {price.toLocaleString('id-ID')}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              {slots} slot × {durationDays} hari{singleImage ? ' (1 gambar full)' : ''}
            </p>
          </div>

          <Button
            fullWidth
            loading={submitting}
            disabled={!file}
            onClick={() => void handleSubmit()}
            icon={<Megaphone size={16} />}
          >
            Kirim Request
          </Button>
        </Card>

        {/* My requests */}
        <div className="mt-6">
          <h3 className="font-semibold text-white mb-3">Riwayat Request</h3>
          <div className="space-y-2">
            {myRequests.length === 0 && (
              <Card className="p-6 text-center text-sm text-slate-500">Belum ada request.</Card>
            )}
            {myRequests.map((r) => (
              <Card key={r.id} className="p-3 flex items-center gap-3">
                <div className="w-16 h-10 rounded overflow-hidden bg-ink-800 shrink-0">
                  <img src={r.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white">{r.slots_requested} slot · {r.duration_days} hari</p>
                  <p className="text-[11px] text-slate-500">
                    {new Date(r.created_at).toLocaleDateString('id-ID')}
                  </p>
                </div>
                <Badge color={r.status === 'PENDING' ? 'amber' : r.status === 'APPROVED' ? 'moss' : 'red'}>
                  {r.status}
                </Badge>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

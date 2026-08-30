import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Check, X, Megaphone, Settings, Clock, DollarSign, CreditCard,
  MessageCircle, Plus, Trash2, Edit3, Eye, EyeOff, Upload, Film, Image as ImageIcon,
  Layers, Move, Calendar, Link as LinkIcon, AlertTriangle,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import {
  loadAllBannerRequests, loadBannerSettings, loadActiveBanners,
  approveBannerRequest, rejectBannerRequest, updateBannerSettings,
  loadPlatformSettings, updatePlatformSetting,
  adminAddBanner, adminUpdateBanner, adminDeleteBanner, adminLoadAllBanners,
  deactivateBanner, uploadBannerMedia,
  type AdBannerRequest, type AdBannerSettings, type AdBanner,
  type PlatformSettings, type AdminBank, type MediaType,
} from '@/services/ad.service';

type Tab = 'slots' | 'requests' | 'settings' | 'payment';

interface BannerEditor {
  mode: 'add' | 'edit';
  bannerId?: string;
  file: File | null;
  previewUrl: string;
  mediaType: MediaType;
  slotNumber: number;
  widthSlots: number;
  linkUrl: string;
  title: string;
  durationDays: number;
  slideDuration: number;
}

const MEDIA_LABELS: Record<MediaType, { label: string; icon: typeof ImageIcon; color: string }> = {
  image: { label: 'Gambar', icon: ImageIcon, color: 'text-blue-400' },
  gif: { label: 'GIF', icon: Film, color: 'text-purple-400' },
  video: { label: 'Video', icon: Film, color: 'text-amber-400' },
};

export function AdminBannersPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState<Tab>('slots');
  const [requests, setRequests] = useState<AdBannerRequest[]>([]);
  const [allBanners, setAllBanners] = useState<AdBanner[]>([]);
  const [settings, setSettings] = useState<AdBannerSettings | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [bankEditor, setBankEditor] = useState<AdminBank | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<BannerEditor | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [reqs, bans, s, ps] = await Promise.all([
        loadAllBannerRequests(),
        adminLoadAllBanners(),
        loadBannerSettings(),
        loadPlatformSettings(),
      ]);
      setRequests(reqs);
      setAllBanners(bans);
      setSettings(s);
      setPlatformSettings(ps);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat data banner.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const pending = requests.filter((r) => r.status === 'PENDING');
  const activeBanners = allBanners.filter((b) => b.is_active);
  const usedSlots = new Set(activeBanners.map((b) => b.slot_number));

  // ── Approve / Reject ──
  const handleApprove = async (id: string) => {
    if (!settings) return toast('Settings belum tersedia.', 'error');
    setBusy(id);
    try {
      await approveBannerRequest(id, settings);
      toast('Banner disetujui dan ditayangkan.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal approve.', 'error');
    } finally { setBusy(null); }
  };

  const handleReject = async (id: string) => {
    const note = window.prompt('Alasan penolakan:')?.trim() || '';
    if (!note) return;
    setBusy(id);
    try {
      await rejectBannerRequest(id, note);
      toast('Banner ditolak.', 'info');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal reject.', 'error');
    } finally { setBusy(null); }
  };

  // ── Takedown ──
  const handleTakedown = async (id: string) => {
    if (!confirm('Takedown banner ini? Banner akan disembunyikan dari halaman beranda.')) return;
    setBusy(id);
    try {
      await deactivateBanner(id);
      toast('Banner ditakedown.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal takedown.', 'error');
    } finally { setBusy(null); }
  };

  // ── Delete permanently ──
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus banner ini secara permanen?')) return;
    setBusy(id);
    try {
      await adminDeleteBanner(id);
      toast('Banner dihapus.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menghapus.', 'error');
    } finally { setBusy(null); }
  };

  // ── Editor: file select ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    let mediaType: MediaType = 'image';
    if (ext === 'gif' || file.type === 'image/gif') mediaType = 'gif';
    else if (ext === 'mp4' || file.type === 'video/mp4') mediaType = 'video';

    const maxSize = mediaType === 'video' || mediaType === 'gif' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast(`Ukuran maksimal ${Math.round(maxSize / 1024 / 1024)}MB untuk ${mediaType === 'video' ? 'video' : mediaType === 'gif' ? 'GIF' : 'gambar'}.`, 'error');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setEditor((prev) => prev ? { ...prev, file, previewUrl, mediaType } : null);
    e.target.value = '';
  };

  // ── Open editor ──
  const openAddEditor = () => {
    const nextSlot = (() => {
      let s = 1;
      while (usedSlots.has(s)) s++;
      return s;
    })();
    setEditor({
      mode: 'add',
      file: null,
      previewUrl: '',
      mediaType: 'image',
      slotNumber: nextSlot,
      widthSlots: 1,
      linkUrl: '',
      title: '',
      durationDays: 30,
      slideDuration: settings?.slide_duration_seconds ?? 45,
    });
  };

  const openEditEditor = (banner: AdBanner) => {
    setEditor({
      mode: 'edit',
      bannerId: banner.id,
      file: null,
      previewUrl: banner.image_url,
      mediaType: banner.media_type || 'image',
      slotNumber: banner.slot_number,
      widthSlots: banner.image_width_slots,
      linkUrl: banner.link_url || '',
      title: banner.title || '',
      durationDays: Math.max(1, Math.ceil((new Date(banner.expires_at).getTime() - Date.now()) / 86400000)),
      slideDuration: banner.slide_duration_seconds,
    });
  };

  // ── Save banner ──
  const handleSaveBanner = async () => {
    if (!editor) return;
    setUploading(true);
    try {
      if (editor.mode === 'add') {
        if (!editor.file) return toast('Pilih file terlebih dahulu.', 'error');
        await adminAddBanner({
          file: editor.file,
          slotNumber: editor.slotNumber,
          widthSlots: editor.widthSlots,
          linkUrl: editor.linkUrl,
          title: editor.title,
          durationDays: editor.durationDays,
          slideDuration: editor.slideDuration,
        });
        toast('Banner berhasil ditambahkan.', 'success');
      } else {
        const patch: Partial<AdBanner> = {
          slot_number: editor.slotNumber,
          image_width_slots: editor.widthSlots,
          link_url: editor.linkUrl,
          title: editor.title,
          single_image: editor.widthSlots > 1,
          slide_duration_seconds: editor.slideDuration,
        };
        // If new file uploaded, replace media
        if (editor.file) {
          const uploaded = await uploadBannerMedia(editor.file, `sykabelajar/banners/admin/${Date.now()}`);
          patch.image_url = uploaded.secure_url;
          patch.image_urls = [uploaded.secure_url];
          patch.media_type = uploaded.media_type;
        }
        // Update expiry
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + editor.durationDays);
        patch.expires_at = expiresAt.toISOString();

        await adminUpdateBanner(editor.bannerId!, patch);
        toast('Banner diperbarui.', 'success');
      }
      setEditor(null);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan banner.', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Settings save ──
  const handleSettingsSave = async () => {
    if (!settings) return;
    try {
      await updateBannerSettings(settings);
      toast('Pengaturan banner disimpan.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan.', 'error');
    }
  };

  const handlePlatformSave = async (key: string, value: any) => {
    try {
      await updatePlatformSetting(key, value);
      toast('Pengaturan disimpan.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan.', 'error');
    }
  };

  const addBank = () => setBankEditor({ bank: '', name: '', number: '' });
  const saveBank = async () => {
    if (!bankEditor || !platformSettings) return;
    const banks = [...platformSettings.admin_banks, bankEditor];
    await handlePlatformSave('admin_banks', banks);
    setPlatformSettings({ ...platformSettings, admin_banks: banks });
    setBankEditor(null);
  };
  const removeBank = async (idx: number) => {
    if (!platformSettings || !confirm('Hapus rekening ini?')) return;
    const banks = platformSettings.admin_banks.filter((_, i) => i !== idx);
    await handlePlatformSave('admin_banks', banks);
    setPlatformSettings({ ...platformSettings, admin_banks: banks });
  };

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Link to="/admin" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5">
          <ArrowLeft size={14} /> Kembali ke Admin
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-moss-400">BANNER ADS</p>
            <h1 className="text-2xl font-bold text-fg">Manajemen Iklan</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="moss">{activeBanners.length} aktif</Badge>
            {pending.length > 0 && <Badge color="warn">{pending.length} pending</Badge>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 surface-elevated rounded-xl p-1 mb-6 overflow-x-auto no-scrollbar">
          {([
            ['slots', 'Slot Iklan', Layers],
            ['requests', 'Request Masuk', Megaphone],
            ['settings', 'Pengaturan Harga', Settings],
            ['payment', 'Pembayaran & Chat', CreditCard],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                tab === key ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500 hover:text-fg-secondary'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ═══ TAB: SLOT MANAGEMENT ═══ */}
        {tab === 'slots' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Kelola semua slot iklan — tambah, edit, atau takedown</p>
              <Button size="sm" icon={<Plus size={14} />} onClick={openAddEditor}>
                Tambah Iklan
              </Button>
            </div>

            {loading && <Card className="p-8 text-center text-slate-500">Memuat...</Card>}

            {!loading && allBanners.length === 0 && (
              <Card className="p-8 text-center text-slate-500">Belum ada banner.</Card>
            )}

            {/* Slot grid */}
            {!loading && (
              <div className="grid gap-3">
                {allBanners.map((b) => {
                  const mediaInfo = MEDIA_LABELS[b.media_type || 'image'];
                  const MediaIcon = mediaInfo.icon;
                  const isExpired = new Date(b.expires_at) < new Date();
                  return (
                    <Card key={b.id} className={`p-4 transition-all duration-200 ${
                      !b.is_active ? 'opacity-50 surface-border' :
                      isExpired ? 'border-amber-500/20' : 'surface-border hover:border-moss-500/20'
                    }`}>
                      <div className="flex items-center gap-4">
                        {/* Preview */}
                        <div className="w-28 h-18 rounded-lg overflow-hidden surface-elevated shrink-0 flex">
                          {b.media_type === 'video' ? (
                            <video src={b.image_url} className="w-full h-full object-cover" muted preload="metadata" />
                          ) : (
                            <img src={b.image_url} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge color={b.is_active ? 'moss' : 'default'}>
                              Slot #{b.slot_number}
                            </Badge>
                            <span className={`flex items-center gap-1 text-[10px] ${mediaInfo.color}`}>
                              <MediaIcon size={10} /> {mediaInfo.label}
                            </span>
                            {b.image_width_slots > 1 && (
                              <span className="text-[10px] text-slate-500">×{b.image_width_slots} slot</span>
                            )}
                            {isExpired && <Badge color="warn">Expired</Badge>}
                            {!b.is_active && <Badge color="err">Nonaktif</Badge>}
                          </div>
                          {b.title && <p className="text-sm text-white font-medium truncate">{b.title}</p>}
                          <p className="text-[11px] text-slate-500 truncate">
                            {b.link_url || '—'} · expires {new Date(b.expires_at).toLocaleDateString('id-ID')}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => openEditEditor(b)}
                            className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </button>
                          {b.is_active ? (
                            <button
                              onClick={() => void handleTakedown(b.id)}
                              className="p-2 rounded-lg hover:bg-amber-500/10 text-amber-400 hover:text-amber-300 transition"
                              title="Takedown"
                              disabled={busy === b.id}
                            >
                              <EyeOff size={14} />
                            </button>
                          ) : (
                            <button
                              onClick={async () => {
                                setBusy(b.id);
                                await adminUpdateBanner(b.id, { is_active: true });
                                toast('Banner diaktifkan kembali.', 'success');
                                await load();
                                setBusy(null);
                              }}
                              className="p-2 rounded-lg hover:bg-moss-500/10 text-moss-400 hover:text-moss-300 transition"
                              title="Aktifkan"
                              disabled={busy === b.id}
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => void handleDelete(b.id)}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition"
                            title="Hapus permanen"
                            disabled={busy === b.id}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: REQUESTS ═══ */}
        {tab === 'requests' && (
          <div className="space-y-3">
            {loading && <Card className="p-8 text-center text-slate-500">Memuat...</Card>}
            {!loading && requests.length === 0 && (
              <Card className="p-8 text-center text-slate-500">Belum ada request banner.</Card>
            )}
            {requests.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="w-20 h-14 rounded-lg overflow-hidden surface-elevated shrink-0 flex">
                    {(r.image_urls?.length ? r.image_urls : [r.image_url]).slice(0, 3).map((url, i) => (
                      <img key={i} src={url} alt="" className="h-full object-cover" style={{ width: `${100 / Math.min(r.image_urls?.length || 1, 3)}%` }} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={r.status === 'PENDING' ? 'warn' : r.status === 'APPROVED' ? 'moss' : 'err'}>
                        {r.status}
                      </Badge>
                      <span className="text-[11px] text-slate-600">
                        {new Date(r.created_at).toLocaleDateString('id-ID')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {r.slots_requested} slot · {r.duration_days} hari ·{' '}
                      {r.image_urls?.length ? `${r.image_urls.length} gambar` : '1 gambar'}
                    </p>
                    <p className="text-sm text-moss-300 font-semibold mt-1">
                      Rp {r.total_price.toLocaleString('id-ID')}
                    </p>
                    {r.admin_note && (
                      <p className="text-[11px] text-red-400 mt-1">Catatan: {r.admin_note}</p>
                    )}
                  </div>
                  {r.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy === r.id} onClick={() => void handleApprove(r.id)} icon={<Check size={14} />}>
                        Acc
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void handleReject(r.id)} icon={<X size={14} />}>
                        Tolak
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* ═══ TAB: SETTINGS ═══ */}
        {tab === 'settings' && settings && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4 text-fg font-semibold">
              <Settings size={18} className="text-moss-400" /> Pengaturan Harga & Durasi
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Durasi slide (detik)</label>
                <input type="number" value={settings.slide_duration_seconds}
                  onChange={(e) => setSettings({ ...settings, slide_duration_seconds: +e.target.value })}
                  className="input text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga per lot/hari (Rp)</label>
                <input type="number" value={settings.price_per_lot_daily}
                  onChange={(e) => setSettings({ ...settings, price_per_lot_daily: +e.target.value })}
                  className="input text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Diskon bundle 3 lot (%)</label>
                <input type="number" value={settings.bundle_discount_3lots}
                  onChange={(e) => setSettings({ ...settings, bundle_discount_3lots: +e.target.value })}
                  className="input text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga 1 gambar isi 2 slot (Rp/hari)</label>
                <input type="number" value={settings.single_image_2slots_price}
                  onChange={(e) => setSettings({ ...settings, single_image_2slots_price: +e.target.value })}
                  className="input text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga 1 gambar isi 3 slot (Rp/hari)</label>
                <input type="number" value={settings.single_image_3slots_price}
                  onChange={(e) => setSettings({ ...settings, single_image_3slots_price: +e.target.value })}
                  className="input text-sm w-full" />
              </div>
            </div>
            <div className="mt-4 p-3 rounded-lg surface-elevated border surface-border">
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-400" />
                Format yang didukung: Gambar (JPG, PNG, WebP, max 5MB) · GIF (max 2MB) · Video MP4 (max 2MB)
              </p>
            </div>
            <Button className="mt-6" onClick={() => void handleSettingsSave()}>
              Simpan Pengaturan
            </Button>
          </Card>
        )}

        {/* ═══ TAB: PAYMENT ═══ */}
        {tab === 'payment' && platformSettings && (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-fg font-semibold">
                  <CreditCard size={18} className="text-moss-400" /> Rekening Bank Admin
                </div>
                <Button size="sm" icon={<Plus size={14} />} onClick={addBank}>Tambah</Button>
              </div>
              <div className="space-y-3">
                {platformSettings.admin_banks.map((bank, i) => (
                  <div key={i} className="surface-elevated rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-moss-400 font-semibold">{bank.bank}</p>
                      <p className="text-sm text-fg">{bank.number}</p>
                      <p className="text-[11px] text-slate-500">a.n. {bank.name}</p>
                    </div>
                    <button onClick={() => void removeBank(i)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {platformSettings.admin_banks.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-3">Belum ada rekening.</p>
                )}
              </div>
              {bankEditor && (
                <div className="mt-4 surface-elevated/30 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Bank</label>
                      <input value={bankEditor.bank} onChange={e => setBankEditor({ ...bankEditor, bank: e.target.value })} placeholder="BCA" className="input text-sm w-full" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Atas Nama</label>
                      <input value={bankEditor.name} onChange={e => setBankEditor({ ...bankEditor, name: e.target.value })} placeholder="PT ..." className="input text-sm w-full" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Nomor Rekening</label>
                      <input value={bankEditor.number} onChange={e => setBankEditor({ ...bankEditor, number: e.target.value })} placeholder="1234567890" className="input text-sm w-full" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void saveBank()}>Simpan</Button>
                    <Button size="sm" variant="outline" onClick={() => setBankEditor(null)}>Batal</Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4 text-fg font-semibold">
                <MessageCircle size={18} className="text-moss-400" /> Pengaturan Chat & WhatsApp
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Nomor WhatsApp Admin</label>
                  <input type="tel" value={platformSettings.whatsapp_number}
                    onChange={e => setPlatformSettings({ ...platformSettings, whatsapp_number: e.target.value })}
                    placeholder="6281234567890" className="input text-sm w-full" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-400">Aktifkan Chat</label>
                  <button onClick={() => setPlatformSettings({ ...platformSettings, chat_enabled: !platformSettings.chat_enabled })}
                    className={`w-10 h-5 rounded-full transition ${platformSettings.chat_enabled ? 'bg-moss-500' : 'surface-elevated'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${platformSettings.chat_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tipe Chat</label>
                  <div className="flex gap-2">
                    {(['whatsapp', 'internal'] as const).map(t => (
                      <button key={t} onClick={() => setPlatformSettings({ ...platformSettings, chat_type: t })}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                          platformSettings.chat_type === t ? 'border-moss-500 bg-moss-500/10 text-moss-300' : 'surface-border text-slate-500 hover:border-white/20'
                        }`}>
                        {t === 'whatsapp' ? 'WhatsApp' : 'Chat Internal'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Button className="mt-6" onClick={() => {
                handlePlatformSave('whatsapp_number', platformSettings.whatsapp_number);
                handlePlatformSave('chat_enabled', platformSettings.chat_enabled);
                handlePlatformSave('chat_type', platformSettings.chat_type);
              }}>
                Simpan Pengaturan
              </Button>
            </Card>
          </div>
        )}

        {/* ═══ BANNER EDITOR MODAL ═══ */}
        {editor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !uploading && setEditor(null)} />
            <div className="relative surface-card-bg border surface-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-fg">
                  {editor.mode === 'add' ? 'Tambah Iklan Baru' : 'Edit Iklan'}
                </h3>
                <button onClick={() => !uploading && setEditor(null)} className="text-slate-400 hover:text-fg">✕</button>
              </div>

              {/* File upload */}
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-2">File Media</label>
                <input ref={fileRef} type="file" accept="image/*,video/mp4,.gif" className="hidden" onChange={handleFileSelect} />
                {editor.previewUrl ? (
                  <div className="relative rounded-xl overflow-hidden surface-elevated">
                    {editor.mediaType === 'video' ? (
                      <video src={editor.previewUrl} className="w-full h-40 object-cover" controls muted />
                    ) : (
                      <img src={editor.previewUrl} alt="" className="w-full h-40 object-cover" />
                    )}
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/60 text-xs text-white flex items-center gap-1.5"
                    >
                      <Upload size={12} /> Ganti
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full h-32 rounded-xl border-2 border-dashed surface-border flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-moss-500/30 hover:text-moss-400/60 transition"
                  >
                    <Upload size={24} />
                    <span className="text-xs">Klik untuk upload</span>
                    <span className="text-[10px] text-slate-600">JPG, PNG, GIF (max 2MB) · MP4 (max 2MB)</span>
                  </button>
                )}
              </div>

              {/* Slot number */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Nomor Slot</label>
                  <input type="number" min={1} value={editor.slotNumber}
                    onChange={e => setEditor({ ...editor, slotNumber: +e.target.value })}
                    className="input text-sm w-full" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Lebar Slot</label>
                  <select value={editor.widthSlots}
                    onChange={e => setEditor({ ...editor, widthSlots: +e.target.value })}
                    className="input text-sm w-full">
                    <option value={1}>1 slot (standar)</option>
                    <option value={2}>2 slot (lebar)</option>
                    <option value={3}>3 slot (full width)</option>
                  </select>
                </div>
              </div>

              {/* Title */}
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1">Judul (opsional)</label>
                <input value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })}
                  placeholder="Nama iklan" className="input text-sm w-full" />
              </div>

              {/* Link URL */}
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                  <LinkIcon size={10} /> Link URL
                </label>
                <input value={editor.linkUrl} onChange={e => setEditor({ ...editor, linkUrl: e.target.value })}
                  placeholder="https://..." className="input text-sm w-full" />
              </div>

              {/* Duration & slide */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div>
                  <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                    <Calendar size={10} /> Durasi (hari)
                  </label>
                  <input type="number" min={1} max={365} value={editor.durationDays}
                    onChange={e => setEditor({ ...editor, durationDays: +e.target.value })}
                    className="input text-sm w-full" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                    <Clock size={10} /> Slide (detik)
                  </label>
                  <input type="number" min={5} max={120} value={editor.slideDuration}
                    onChange={e => setEditor({ ...editor, slideDuration: +e.target.value })}
                    className="input text-sm w-full" />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button fullWidth loading={uploading} onClick={() => void handleSaveBanner()}>
                  {editor.mode === 'add' ? 'Tambah Iklan' : 'Simpan Perubahan'}
                </Button>
                <Button fullWidth variant="outline" disabled={uploading} onClick={() => setEditor(null)}>
                  Batal
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

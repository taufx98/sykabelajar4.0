import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, Megaphone, Settings, Clock, DollarSign } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import {
  loadAllBannerRequests,
  loadBannerSettings,
  loadActiveBanners,
  approveBannerRequest,
  rejectBannerRequest,
  updateBannerSettings,
  type AdBannerRequest,
  type AdBannerSettings,
  type AdBanner,
} from '@/services/ad.service';

export function AdminBannersPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'requests' | 'active' | 'settings'>('requests');
  const [requests, setRequests] = useState<AdBannerRequest[]>([]);
  const [activeBanners, setActiveBanners] = useState<AdBanner[]>([]);
  const [settings, setSettings] = useState<AdBannerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [reqs, bans, s] = await Promise.all([
        loadAllBannerRequests(),
        loadActiveBanners(),
        loadBannerSettings(),
      ]);
      setRequests(reqs);
      setActiveBanners(bans);
      setSettings(s);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat data banner.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleApprove = async (id: string) => {
    if (!settings) return toast('Settings belum tersedia.', 'error');
    setBusy(id);
    try {
      await approveBannerRequest(id, settings);
      toast('Banner disetujui dan ditayangkan.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal approve.', 'error');
    } finally {
      setBusy(null);
    }
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
    } finally {
      setBusy(null);
    }
  };

  const handleSettingsSave = async () => {
    if (!settings) return;
    try {
      await updateBannerSettings(settings);
      toast('Pengaturan banner disimpan.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan.', 'error');
    }
  };

  const pending = requests.filter((r) => r.status === 'PENDING');

  return (
    <div className="min-h-screen bg-ink-950 text-slate-200 p-5 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Link to="/admin" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white mb-5">
          <ArrowLeft size={14} /> Kembali ke Admin
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-moss-400">BANNER ADS</p>
            <h1 className="text-2xl font-bold text-white">Pengaturan Iklan</h1>
          </div>
          <Badge color="moss"><Megaphone size={14} /> {pending.length} pending</Badge>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-ink-800 rounded-xl p-1 mb-6 max-w-md">
          {([
            ['requests', 'Request Masuk'],
            ['active', 'Banner Aktif'],
            ['settings', 'Pengaturan Harga'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 px-4 py-2 rounded-lg text-xs font-medium transition ${
                tab === key ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Requests */}
        {tab === 'requests' && (
          <div className="space-y-3">
            {loading && <Card className="p-8 text-center text-slate-500">Memuat...</Card>}
            {!loading && requests.length === 0 && (
              <Card className="p-8 text-center text-slate-500">Belum ada request banner.</Card>
            )}
            {requests.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="w-20 h-14 rounded-lg overflow-hidden bg-ink-800 shrink-0">
                    <img src={r.image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={r.status === 'PENDING' ? 'amber' : r.status === 'APPROVED' ? 'moss' : 'red'}>
                        {r.status}
                      </Badge>
                      <span className="text-[11px] text-slate-600">
                        {new Date(r.created_at).toLocaleDateString('id-ID')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {r.slots_requested} slot · {r.duration_days} hari ·{' '}
                      {r.single_image ? '1 gambar (full)' : `${r.slots_requested} gambar`}
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
                      <Button
                        size="sm"
                        loading={busy === r.id}
                        onClick={() => void handleApprove(r.id)}
                        icon={<Check size={14} />}
                      >
                        Acc
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() => void handleReject(r.id)}
                        icon={<X size={14} />}
                      >
                        Tolak
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Active banners */}
        {tab === 'active' && (
          <div className="space-y-3">
            {activeBanners.length === 0 && (
              <Card className="p-8 text-center text-slate-500">Belum ada banner aktif.</Card>
            )}
            {activeBanners.map((b) => (
              <Card key={b.id} className="p-4 flex items-center gap-4">
                <div className="w-24 h-16 rounded-lg overflow-hidden bg-ink-800 shrink-0">
                  <img src={b.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-white">Slot #{b.slot_number}</p>
                  <p className="text-xs text-slate-500">
                    {b.image_width_slots} slot width · expires{' '}
                    {new Date(b.expires_at).toLocaleDateString('id-ID')}
                  </p>
                </div>
                <Badge color="moss">Aktif</Badge>
              </Card>
            ))}
          </div>
        )}

        {/* Settings */}
        {tab === 'settings' && settings && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4 text-white font-semibold">
              <Settings size={18} className="text-moss-400" /> Pengaturan Harga & Durasi
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Durasi slide (detik)</label>
                <input
                  type="number"
                  value={settings.slide_duration_seconds}
                  onChange={(e) => setSettings({ ...settings, slide_duration_seconds: +e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga per lot/hari (Rp)</label>
                <input
                  type="number"
                  value={settings.price_per_lot_daily}
                  onChange={(e) => setSettings({ ...settings, price_per_lot_daily: +e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Diskon bundle 3 lot (%)</label>
                <input
                  type="number"
                  value={settings.bundle_discount_3lots}
                  onChange={(e) => setSettings({ ...settings, bundle_discount_3lots: +e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga 1 gambar isi 2 slot (Rp/hari)</label>
                <input
                  type="number"
                  value={settings.single_image_2slots_price}
                  onChange={(e) => setSettings({ ...settings, single_image_2slots_price: +e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga 1 gambar isi 3 slot (Rp/hari)</label>
                <input
                  type="number"
                  value={settings.single_image_3slots_price}
                  onChange={(e) => setSettings({ ...settings, single_image_3slots_price: +e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
            </div>
            <Button className="mt-6" onClick={() => void handleSettingsSave()}>
              Simpan Pengaturan
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

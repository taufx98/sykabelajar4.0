import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Gift, Info, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

type ReferralMilestoneDraft = {
  target: string;
  title: string;
  display_amount: string;
  bonus_amount: string;
  bonus_label: string;
  total_note: string;
  tag: string;
};

type ReferralSettingsDraft = {
  is_active: boolean;
  base_reward_amount: string;
  event_reward_amount: string;
  event_name: string;
  event_description: string;
  starts_at: string;
  ends_at: string;
  milestone_tiers: ReferralMilestoneDraft[];
  promo_is_enabled: boolean;
  promo_title: string;
  promo_description: string;
  promo_badge: string;
  promo_cta: string;
};

type ReferralSettings = {
  is_active: boolean;
  reward_amount: number;
  base_reward_amount: number;
  event_reward_amount: number | null;
  event_name: string | null;
  event_description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_event_active: boolean;
  is_available: boolean;
  milestone_tiers: Array<{
    target: number;
    title: string;
    display_amount: string;
    bonus_amount: number;
    bonus_label: string | null;
    total_note: string | null;
    tag: string | null;
  }>;
  promo_is_enabled: boolean;
  promo_title: string;
  promo_description: string;
  promo_badge: string;
  promo_cta: string;
};

const DEFAULT_TIERS: ReferralMilestoneDraft[] = [
  { target: '1', title: 'Target Pertama', display_amount: '5 Coin', bonus_amount: '0', bonus_label: '', total_note: '', tag: '' },
  { target: '25', title: 'Progress Konsisten', display_amount: '145 Coin', bonus_amount: '20', bonus_label: '+20 Bonus', total_note: '', tag: '' },
  { target: '100', title: 'Komunitas Berkembang', display_amount: '650 Coin', bonus_amount: '150', bonus_label: '+150 Coin Bonus', total_note: '', tag: '' },
  { target: '1000', title: 'Target Komunitas', display_amount: '950 Coin', bonus_amount: '250', bonus_label: '+250 Bonus Coin', total_note: '(700 + 250)', tag: 'ULTRA' },
];

const DEFAULT_DRAFT: ReferralSettingsDraft = {
  is_active: true,
  base_reward_amount: '5',
  event_reward_amount: '',
  event_name: '',
  event_description: '',
  starts_at: '',
  ends_at: '',
  milestone_tiers: DEFAULT_TIERS,
  promo_is_enabled: true,
  promo_title: 'Ajak Teman, Dapatkan Edu Coin!',
  promo_description: 'Dapatkan {reward} Edu Coin untuk setiap teman yang memenuhi syarat program referral.',
  promo_badge: 'Bonus Aktif',
  promo_cta: 'Buka Program Referral',
};

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sameDateTime(left: string | null, right: string | null) {
  if (!left || !right) return !left && !right;
  return new Date(left).getTime() === new Date(right).getTime();
}

function readSettings(data: unknown): ReferralSettings | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  const milestoneTiers = Array.isArray(value.milestone_tiers)
    ? value.milestone_tiers as ReferralSettings['milestone_tiers']
    : [];
  return {
    is_active: Boolean(value.is_active),
    reward_amount: Number(value.reward_amount) || 0,
    base_reward_amount: Number(value.base_reward_amount) || 0,
    event_reward_amount: value.event_reward_amount == null ? null : Number(value.event_reward_amount),
    event_name: typeof value.event_name === 'string' ? value.event_name : null,
    event_description: typeof value.event_description === 'string' ? value.event_description : null,
    starts_at: typeof value.starts_at === 'string' ? value.starts_at : null,
    ends_at: typeof value.ends_at === 'string' ? value.ends_at : null,
    is_event_active: Boolean(value.is_event_active),
    is_available: Boolean(value.is_available),
    milestone_tiers: milestoneTiers,
    promo_is_enabled: value.promo_is_enabled !== false,
    promo_title: typeof value.promo_title === 'string' ? value.promo_title : DEFAULT_DRAFT.promo_title,
    promo_description: typeof value.promo_description === 'string' ? value.promo_description : DEFAULT_DRAFT.promo_description,
    promo_badge: typeof value.promo_badge === 'string' ? value.promo_badge : DEFAULT_DRAFT.promo_badge,
    promo_cta: typeof value.promo_cta === 'string' ? value.promo_cta : DEFAULT_DRAFT.promo_cta,
  };
}

function toDraft(settings: ReferralSettings): ReferralSettingsDraft {
  const tiers = settings.milestone_tiers.length === 4
    ? settings.milestone_tiers
    : DEFAULT_TIERS.map((tier) => ({
      ...tier,
      target: Number(tier.target),
      bonus_amount: Number(tier.bonus_amount),
      bonus_label: tier.bonus_label || null,
      total_note: tier.total_note || null,
      tag: tier.tag || null,
    }));
  return {
    is_active: settings.is_active,
    base_reward_amount: String(settings.base_reward_amount),
    event_reward_amount: settings.event_reward_amount == null ? '' : String(settings.event_reward_amount),
    event_name: settings.event_name ?? '',
    event_description: settings.event_description ?? '',
    starts_at: toLocalDateTime(settings.starts_at),
    ends_at: toLocalDateTime(settings.ends_at),
    milestone_tiers: tiers.map((tier) => ({
      target: String(tier.target),
      title: tier.title ?? '',
      display_amount: tier.display_amount ?? '',
      bonus_amount: String(tier.bonus_amount ?? 0),
      bonus_label: tier.bonus_label ?? '',
      total_note: tier.total_note ?? '',
      tag: tier.tag ?? '',
    })),
    promo_is_enabled: settings.promo_is_enabled,
    promo_title: settings.promo_title,
    promo_description: settings.promo_description,
    promo_badge: settings.promo_badge,
    promo_cta: settings.promo_cta,
  };
}

export function ReferralSettingsPanel() {
  const { toast } = useApp();
  const [draft, setDraft] = useState<ReferralSettingsDraft>(DEFAULT_DRAFT);
  const [saved, setSaved] = useState<ReferralSettings | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: requestError } = await supabase.rpc('get_referral_program_settings_v2');
      if (requestError) throw requestError;
      const settings = readSettings(data);
      if (!settings) throw new Error('Pengaturan referral belum tersedia.');
      const nextDraft = toDraft(settings);
      setSaved(settings);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(nextDraft));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Gagal memuat pengaturan referral.';
      setError(message);
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const baseReward = Number(draft.base_reward_amount);
  const eventReward = draft.event_reward_amount.trim() === '' ? null : Number(draft.event_reward_amount);
  const validReward = Number.isInteger(baseReward) && baseReward >= 1 && baseReward <= 100_000;
  const validEventReward = eventReward === null || (Number.isInteger(eventReward) && eventReward >= 1 && eventReward <= 100_000);
  const validDates = !draft.starts_at || !draft.ends_at || new Date(draft.ends_at).getTime() > new Date(draft.starts_at).getTime();
  const validTiers = draft.milestone_tiers.length === 4 && draft.milestone_tiers.every((tier, index, tiers) => {
    const target = Number(tier.target);
    const bonus = Number(tier.bonus_amount);
    const previousTarget = index === 0 ? 0 : Number(tiers[index - 1].target);
    return Number.isInteger(target) && target > previousTarget && target <= 1_000_000
      && Number.isInteger(bonus) && bonus >= 0 && bonus <= 100_000
      && tier.display_amount.trim().length > 0 && tier.display_amount.length <= 50
      && tier.title.length <= 80 && tier.bonus_label.length <= 60
      && tier.total_note.length <= 40 && tier.tag.length <= 20;
  });
  const validPromo = draft.promo_title.trim().length > 0 && draft.promo_title.length <= 100
    && draft.promo_description.trim().length > 0 && draft.promo_description.length <= 240
    && draft.promo_badge.length <= 30
    && draft.promo_cta.trim().length > 0 && draft.promo_badge.trim().length > 0 && draft.promo_cta.length > 0 && draft.promo_cta.length <= 60;
  const dirty = Boolean(savedSnapshot) && JSON.stringify(draft) !== savedSnapshot;

  const updateTier = (index: number, key: keyof ReferralMilestoneDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      milestone_tiers: current.milestone_tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, [key]: value } : tier),
    }));
  };

  const save = async () => {
    if (!validReward || !validEventReward || !validDates || !validTiers || !validPromo) {
      toast('Periksa kembali nominal, urutan target tier, periode event, dan teks promo.', 'error');
      return;
    }
    if (eventReward !== null && !draft.event_name.trim()) {
      toast('Isi nama event saat reward khusus event diaktifkan.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data, error: requestError } = await supabase.rpc('admin_update_referral_program_settings_v2', {
        p_is_active: draft.is_active,
        p_base_reward_amount: baseReward,
        p_event_reward_amount: eventReward,
        p_event_name: draft.event_name.trim() || null,
        p_event_description: draft.event_description.trim() || null,
        p_starts_at: toIsoDateTime(draft.starts_at),
        p_ends_at: toIsoDateTime(draft.ends_at),
        p_milestone_tiers: draft.milestone_tiers.map((tier) => ({
          target: Number(tier.target),
          title: tier.title.trim(),
          display_amount: tier.display_amount.trim(),
          bonus_amount: Number(tier.bonus_amount),
          bonus_label: tier.bonus_label.trim() || null,
          total_note: tier.total_note.trim() || null,
          tag: tier.tag.trim() || null,
        })),
        p_promo_is_enabled: draft.promo_is_enabled,
        p_promo_title: draft.promo_title.trim(),
        p_promo_description: draft.promo_description.trim(),
        p_promo_badge: draft.promo_badge.trim(),
        p_promo_cta: draft.promo_cta.trim(),
      });
      if (requestError) throw requestError;
      const settings = readSettings(data);
      if (!settings) throw new Error('Pengaturan tersimpan tetapi data balasan tidak terbaca. Muat ulang untuk memeriksa.');
      const nextDraft = toDraft(settings);
      setSaved(settings);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(nextDraft));
      toast('Pengaturan referral berhasil diperbarui untuk seluruh pengguna.', 'success');
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Gagal menyimpan pengaturan referral.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const programStatus = !saved?.is_active ? 'Program nonaktif' : saved.is_event_active ? 'Bonus event aktif' : 'Reward normal aktif';

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#3B82F6]">Program &amp; Insentif</p>
          <h2 className="mt-1 text-xl font-extrabold text-fg sm:text-2xl">Pengaturan Referral</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted sm:text-sm">Atur hadiah dasar, hadiah event, semua tingkatan bonus, dan tulisan promo yang dilihat seluruh pengguna.</p>
        </div>
        {saved && <Badge color={!saved.is_active ? 'warn' : saved.is_event_active ? 'moss' : 'info'}>{programStatus}</Badge>}
      </header>

      <Card className="overflow-hidden border-[#3B82F6]/20 p-0">
        <div className="flex items-start gap-3 border-b surface-border bg-gradient-to-r from-[#1E3A8A]/10 via-transparent to-indigo-500/5 p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#3B82F6]/10 text-[#3B82F6]"><Gift size={21}/></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-fg">Reward referral global</h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">Reward normal disimpan sebagai snapshot ketika undangan dibuat. Bonus event dipakai untuk referral baru selama periode yang ditentukan.</p>
          </div>
        </div>

        {loading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded-xl surface-elevated"/><div className="h-10 animate-pulse rounded-xl surface-elevated"/></div> : (
          <div className="space-y-5 p-4 sm:p-6">
            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}<button type="button" onClick={() => void load()} className="ml-2 font-bold underline">Coba lagi</button></div>}

            <label className="flex items-center justify-between gap-4 rounded-2xl border surface-border p-4">
              <span className="min-w-0"><span className="block text-sm font-semibold text-fg">Aktifkan program referral</span><span className="mt-1 block text-xs leading-relaxed text-fg-muted">Saat dinonaktifkan, referral baru tidak dicatat dan hadiah dasar tidak diberikan.</span></span>
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-blue-600" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} aria-label="Aktifkan program referral"/>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="label">Reward dasar per referral valid (Edu Coin)</span>
                <input type="number" min={1} max={100000} step={1} inputMode="numeric" className="input mt-1 w-full" value={draft.base_reward_amount} onChange={(event) => setDraft((current) => ({ ...current, base_reward_amount: event.target.value }))}/>
                <span className="mt-1 block text-[10px] text-fg-muted">Nominal 1–100.000. Perubahan tidak mengubah reward referral yang sudah tercatat.</span>
              </label>
              <label className="block">
                <span className="label">Reward event per referral valid (opsional)</span>
                <input type="number" min={1} max={100000} step={1} inputMode="numeric" className="input mt-1 w-full" value={draft.event_reward_amount} onChange={(event) => setDraft((current) => ({ ...current, event_reward_amount: event.target.value }))} placeholder="Kosongkan untuk nonaktif"/>
                <span className="mt-1 block text-[10px] text-fg-muted">Berlaku pada referral baru selama event aktif.</span>
              </label>
              <label className="block md:col-span-2"><span className="label">Nama event (opsional)</span><input className="input mt-1 w-full" maxLength={100} value={draft.event_name} onChange={(event) => setDraft((current) => ({ ...current, event_name: event.target.value }))} placeholder="Contoh: Referral Festival November"/></label>
              <label className="block md:col-span-2"><span className="label">Deskripsi event (opsional)</span><textarea className="input mt-1 min-h-20 w-full resize-y" maxLength={500} value={draft.event_description} onChange={(event) => setDraft((current) => ({ ...current, event_description: event.target.value }))} placeholder="Informasi event yang tampil pada panel referral."/></label>
            </div>

            <div className="rounded-2xl border surface-border p-4">
              <div className="mb-3 flex items-center gap-2"><CalendarClock size={16} className="text-[#3B82F6]"/><span className="text-xs font-bold text-fg">Jadwal bonus event (opsional)</span></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="label">Mulai</span><input type="datetime-local" className="input mt-1 w-full" value={draft.starts_at} onChange={(event) => setDraft((current) => ({ ...current, starts_at: event.target.value }))}/></label>
                <label className="block"><span className="label">Berakhir</span><input type="datetime-local" className="input mt-1 w-full" value={draft.ends_at} onChange={(event) => setDraft((current) => ({ ...current, ends_at: event.target.value }))}/></label>
              </div>
              <p className="mt-2 text-[10px] text-fg-muted">Waktu akhir harus setelah waktu mulai. Zona waktu mengikuti perangkat admin.</p>
              {!validDates && <p className="mt-2 text-xs font-medium text-red-400">Waktu akhir event harus setelah waktu mulai.</p>}
            </div>
          </div>
        )}
      </Card>

      {!loading && (
        <>
          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><Sparkles size={19}/></span>
              <div><h3 className="text-sm font-bold text-fg">Target undangan &amp; bonus tier</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Empat tingkatan mengikuti kartu referral. Isi nominal tampilan dan bonus ekstra yang benar-benar masuk ke dompet ketika target tercapai.</p></div>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {draft.milestone_tiers.map((tier, index) => (
                <div key={index} className="space-y-3 rounded-2xl border surface-border p-4">
                  <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-fg">Tingkat {index + 1}{index === 3 ? ' · ULTRA' : ''}</p><Badge color="info">Tier {index + 1}</Badge></div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block"><span className="label">Target pengguna</span><input type="number" min={1} max={1000000} step={1} className="input mt-1 w-full" value={tier.target} onChange={(event) => updateTier(index, 'target', event.target.value)}/></label>
                    <label className="block"><span className="label">Bonus ekstra (Edu Coin)</span><input type="number" min={0} max={100000} step={1} className="input mt-1 w-full" value={tier.bonus_amount} onChange={(event) => updateTier(index, 'bonus_amount', event.target.value)}/></label>
                    <label className="col-span-2 block"><span className="label">Judul / nama tier</span><input className="input mt-1 w-full" maxLength={80} value={tier.title} onChange={(event) => updateTier(index, 'title', event.target.value)}/></label>
                    <label className="col-span-2 block"><span className="label">Nominal tampilan pada kartu</span><input className="input mt-1 w-full" maxLength={50} value={tier.display_amount} onChange={(event) => updateTier(index, 'display_amount', event.target.value)}/></label>
                    <label className="col-span-2 block"><span className="label">Label bonus (opsional)</span><input className="input mt-1 w-full" maxLength={60} value={tier.bonus_label} onChange={(event) => updateTier(index, 'bonus_label', event.target.value)} placeholder="+20 Bonus"/></label>
                    <label className="block"><span className="label">Catatan total (opsional)</span><input className="input mt-1 w-full" maxLength={40} value={tier.total_note} onChange={(event) => updateTier(index, 'total_note', event.target.value)} placeholder="(700 + 250)"/></label>
                    <label className="block"><span className="label">Tag (opsional)</span><input className="input mt-1 w-full" maxLength={20} value={tier.tag} onChange={(event) => updateTier(index, 'tag', event.target.value)} placeholder="ULTRA"/></label>
                  </div>
                  {index > 0 && Number(tier.target) <= Number(draft.milestone_tiers[index - 1].target) && <p className="text-[10px] font-medium text-red-400">Target harus lebih besar dari tingkat sebelumnya.</p>}
                  {index === 0 && <p className="text-[10px] text-fg-muted">Hadiah dasar per referral tetap berjalan; bonus ekstra 0 berarti tidak ada bonus tambahan pada target ini.</p>}
                </div>
              ))}
            </div>
            {!validTiers && <p className="text-xs font-medium text-red-400">Target harus bilangan bulat berurutan naik, bonus 0–100.000 Coin, dan nominal tampilan tidak boleh kosong.</p>}
          </Card>

          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3B82F6]/10 text-[#3B82F6]"><Gift size={19}/></span>
              <div><h3 className="text-sm font-bold text-fg">Konten promo di halaman Notifikasi</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Atur teks pada banner “Ajak Teman”. Semua perubahan tampil untuk seluruh pengguna setelah disimpan.</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="label">Judul promo</span><input className="input mt-1 w-full" maxLength={100} value={draft.promo_title} onChange={(event) => setDraft((current) => ({ ...current, promo_title: event.target.value }))}/></label>
              <label className="block sm:col-span-2"><span className="label">Deskripsi promo</span><textarea className="input mt-1 min-h-20 w-full resize-y" maxLength={240} value={draft.promo_description} onChange={(event) => setDraft((current) => ({ ...current, promo_description: event.target.value }))}/><span className="mt-1 block text-[10px] text-fg-muted">Gunakan <code>{'{reward}'}</code> untuk menyisipkan nominal reward aktif secara otomatis.</span></label>
              <label className="block"><span className="label">Badge status</span><input className="input mt-1 w-full" maxLength={30} value={draft.promo_badge} onChange={(event) => setDraft((current) => ({ ...current, promo_badge: event.target.value }))}/></label>
              <label className="block"><span className="label">Teks tombol</span><input className="input mt-1 w-full" maxLength={60} value={draft.promo_cta} onChange={(event) => setDraft((current) => ({ ...current, promo_cta: event.target.value }))}/></label>
            </div>
            <div className="rounded-xl border border-[#3B82F6]/20 bg-[#3B82F6]/5 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#3B82F6]">Pratinjau banner</p>
              <h4 className="mt-2 text-sm font-extrabold text-fg">{draft.promo_title || 'Judul promo'}</h4>
              <p className="mt-1 text-xs text-fg-muted">{draft.promo_description.split('{reward}').join(`${(saved?.reward_amount ?? (baseReward || 0)).toLocaleString('id-ID')} Edu Coin`)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2"><Badge color="moss">{draft.promo_badge || 'Badge'}</Badge><span className="rounded-lg bg-[#2563EB] px-3 py-2 text-[10px] font-bold text-white">{draft.promo_cta || 'Tombol'}</span></div>
            </div>
            {!validPromo && <p className="text-xs font-medium text-red-400">Judul, deskripsi, badge, dan teks tombol promo wajib diisi dan tidak boleh melebihi batas karakter.</p>}
          </Card>

          <Card className="flex items-start gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><Info size={17}/></span>
            <div><h3 className="text-xs font-bold text-fg">Aturan pembayaran dan riwayat</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Bonus ekstra tier diambil dari kolom “Bonus ekstra” dan otomatis dikreditkan satu kali per target ke ledger Edu Coin. Mengubah bonus pada target yang sudah pernah dibayar tidak mengulang pembayaran. Target baru yang sudah dipenuhi pengguna dapat diproses saat pengaturan disimpan. Nominal tampilan kartu adalah teks yang bisa disesuaikan; bukan rumus pembayaran. Reward dasar referral lama tidak dihitung ulang.</p></div>
          </Card>

          <Card className="flex items-start gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><ShieldCheck size={17}/></span>
            <div><h3 className="text-xs font-bold text-fg">Validasi sisi server</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Hanya admin yang dapat menyimpan perubahan. Backend memvalidasi urutan target, batas nominal, dan konten promo; konfigurasi tersimpan secara global dan disebarkan sebagai invalidasi realtime tanpa mengekspos pengaturan privat.</p></div>
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={saving}>Muat Ulang</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !validReward || !validEventReward || !validDates || !validTiers || !validPromo || !dirty} loading={saving} icon={<Save size={14}/>}>Simpan Pengaturan</Button>
          </div>
        </>
      )}
    </div>
  );
}

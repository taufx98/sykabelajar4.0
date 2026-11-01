import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Gift, Info, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

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
};

type ReferralSettingsDraft = {
  is_active: boolean;
  base_reward_amount: string;
  event_reward_amount: string;
  event_name: string;
  event_description: string;
  starts_at: string;
  ends_at: string;
};

const emptyDraft: ReferralSettingsDraft = {
  is_active: true,
  base_reward_amount: '5',
  event_reward_amount: '',
  event_name: '',
  event_description: '',
  starts_at: '',
  ends_at: '',
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
  };
}

export function ReferralSettingsPanel() {
  const { toast } = useApp();
  const [draft, setDraft] = useState<ReferralSettingsDraft>(emptyDraft);
  const [saved, setSaved] = useState<ReferralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: requestError } = await supabase.rpc('get_referral_program_settings');
      if (requestError) throw requestError;
      const settings = readSettings(data);
      if (!settings) throw new Error('Pengaturan referral belum tersedia.');
      setSaved(settings);
      setDraft({
        is_active: settings.is_active,
        base_reward_amount: String(settings.base_reward_amount),
        event_reward_amount: settings.event_reward_amount == null ? '' : String(settings.event_reward_amount),
        event_name: settings.event_name ?? '',
        event_description: settings.event_description ?? '',
        starts_at: toLocalDateTime(settings.starts_at),
        ends_at: toLocalDateTime(settings.ends_at),
      });
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
  const dirty = Boolean(saved) && (
    draft.is_active !== saved?.is_active
    || baseReward !== saved?.base_reward_amount
    || eventReward !== saved?.event_reward_amount
    || draft.event_name.trim() !== (saved?.event_name ?? '')
    || draft.event_description.trim() !== (saved?.event_description ?? '')
    || !sameDateTime(toIsoDateTime(draft.starts_at), saved?.starts_at ?? null)
    || !sameDateTime(toIsoDateTime(draft.ends_at), saved?.ends_at ?? null)
  );

  const save = async () => {
    if (!validReward || !validEventReward) {
      toast('Reward harus berupa bilangan bulat antara 1 sampai 100.000 Edu Coin.', 'error');
      return;
    }
    if (!validDates) {
      toast('Waktu akhir event harus setelah waktu mulai.', 'error');
      return;
    }
    if (eventReward !== null && !draft.event_name.trim()) {
      toast('Isi nama event saat reward khusus event diaktifkan.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data, error: requestError } = await supabase.rpc('admin_update_referral_program_settings', {
        p_is_active: draft.is_active,
        p_base_reward_amount: baseReward,
        p_event_reward_amount: eventReward,
        p_event_name: draft.event_name.trim() || null,
        p_event_description: draft.event_description.trim() || null,
        p_starts_at: toIsoDateTime(draft.starts_at),
        p_ends_at: toIsoDateTime(draft.ends_at),
      });
      if (requestError) throw requestError;
      const settings = readSettings(data);
      if (!settings) throw new Error('Pengaturan tersimpan tetapi data balasan tidak terbaca. Muat ulang untuk memeriksa.');
      setSaved(settings);
      setDraft({
        is_active: settings.is_active,
        base_reward_amount: String(settings.base_reward_amount),
        event_reward_amount: settings.event_reward_amount == null ? '' : String(settings.event_reward_amount),
        event_name: settings.event_name ?? '',
        event_description: settings.event_description ?? '',
        starts_at: toLocalDateTime(settings.starts_at),
        ends_at: toLocalDateTime(settings.ends_at),
      });
      toast('Pengaturan referral berhasil diperbarui.', 'success');
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Gagal menyimpan pengaturan referral.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const programStatus = !saved?.is_active
    ? 'Program nonaktif'
    : saved.is_event_active
      ? 'Bonus event aktif'
      : 'Reward normal aktif';

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#3B82F6]">Program &amp; Insentif</p><h2 className="mt-1 text-xl font-extrabold text-fg sm:text-2xl">Pengaturan Referral</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted sm:text-sm">Atur reward normal dan bonus event. Semua perubahan berlaku global untuk seluruh pengguna.</p></div>
        {saved && <Badge color={!saved.is_active ? 'warn' : saved.is_event_active ? 'moss' : 'info'}>{programStatus}</Badge>}
      </header>

      <Card className="overflow-hidden border-[#3B82F6]/20 p-0">
        <div className="flex items-start gap-3 border-b surface-border bg-gradient-to-r from-[#1E3A8A]/10 via-transparent to-indigo-500/5 p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#3B82F6]/10 text-[#3B82F6]"><Gift size={21}/></span>
          <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-fg">Reward referral global</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Reward normal menjadi nilai dasar. Saat periode bonus event aktif, sistem otomatis menggunakan nominal event. Setelah event berakhir, reward kembali ke nilai normal.</p></div>
        </div>
        {loading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded-xl surface-elevated"/><div className="h-10 animate-pulse rounded-xl surface-elevated"/></div> : (
          <div className="space-y-5 p-4 sm:p-6">
            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}<button type="button" onClick={() => void load()} className="ml-2 font-bold underline">Coba lagi</button></div>}
            <label className="flex items-center justify-between gap-4 rounded-2xl border surface-border p-4">
              <span className="min-w-0"><span className="block text-sm font-semibold text-fg">Aktifkan program referral</span><span className="mt-1 block text-xs leading-relaxed text-fg-muted">Saat dinonaktifkan, akun baru tidak akan dicatat sebagai referral dan tidak akan mendapatkan reward.</span></span>
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-blue-600" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} aria-label="Aktifkan program referral"/>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className="label">Reward normal (Edu Coin)</span><div className="relative mt-1"><input type="number" min={1} max={100000} step={1} inputMode="numeric" className="input w-full pr-24" value={draft.base_reward_amount} onChange={(event) => setDraft((current) => ({ ...current, base_reward_amount: event.target.value }))}/><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-fg-muted">Edu Coin</span></div><span className="mt-1 block text-[10px] text-fg-muted">Nilai default di luar periode event. Minimal 1 dan maksimal 100.000.</span></label>
              <label className="block"><span className="label">Bonus event (Edu Coin, opsional)</span><div className="relative mt-1"><input type="number" min={1} max={100000} step={1} inputMode="numeric" className="input w-full pr-24" value={draft.event_reward_amount} onChange={(event) => setDraft((current) => ({ ...current, event_reward_amount: event.target.value }))} placeholder="Kosongkan untuk nonaktif"/><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-fg-muted">Edu Coin</span></div><span className="mt-1 block text-[10px] text-fg-muted">Nominal ini hanya berlaku dalam periode event. Kosongkan jika tidak ada bonus.</span></label>
              <label className="block md:col-span-2"><span className="label">Nama event (opsional)</span><input className="input mt-1 w-full" maxLength={100} value={draft.event_name} onChange={(event) => setDraft((current) => ({ ...current, event_name: event.target.value }))} placeholder="Contoh: Referral Festival November"/></label>
              <label className="block md:col-span-2"><span className="label">Deskripsi event (opsional)</span><textarea className="input mt-1 min-h-20 w-full resize-y" maxLength={500} value={draft.event_description} onChange={(event) => setDraft((current) => ({ ...current, event_description: event.target.value }))} placeholder="Tulis informasi singkat yang akan dilihat pengguna pada halaman referral."/></label>
            </div>

            <div className="rounded-2xl border surface-border p-4">
              <div className="mb-3 flex items-center gap-2"><CalendarClock size={16} className="text-[#3B82F6]"/><span className="text-xs font-bold text-fg">Jadwal bonus event (opsional)</span></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="label">Mulai</span><input type="datetime-local" className="input mt-1 w-full" value={draft.starts_at} onChange={(event) => setDraft((current) => ({ ...current, starts_at: event.target.value }))}/></label>
                <label className="block"><span className="label">Berakhir</span><input type="datetime-local" className="input mt-1 w-full" value={draft.ends_at} onChange={(event) => setDraft((current) => ({ ...current, ends_at: event.target.value }))}/></label>
              </div>
              <p className="mt-2 text-[10px] text-fg-muted">Kosongkan tanggal untuk batas yang tidak ditentukan. Jika dua tanggal diisi, bonus event akan aktif mulai tanggal awal hingga tepat sebelum tanggal akhir. Zona waktu mengikuti perangkat admin.</p>
              {!validDates && <p className="mt-2 text-xs font-medium text-red-400">Waktu akhir harus setelah waktu mulai.</p>}
            </div>

            <div className="rounded-2xl border border-[#3B82F6]/20 bg-[#3B82F6]/5 p-4">
              <div className="flex items-center gap-2"><Sparkles size={15} className="text-[#3B82F6]"/><span className="text-xs font-bold text-fg">Pratinjau skema reward</span></div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div><p className="text-[10px] text-fg-muted">Di luar event</p><p className="mt-0.5 text-lg font-extrabold text-fg">{validReward ? baseReward.toLocaleString('id-ID') : '—'} <span className="text-xs font-semibold text-amber-500">Coin</span></p></div>
                <div><p className="text-[10px] text-fg-muted">Saat event aktif</p><p className="mt-0.5 text-lg font-extrabold text-fg">{validEventReward && eventReward !== null ? eventReward.toLocaleString('id-ID') : validReward ? baseReward.toLocaleString('id-ID') : '—'} <span className="text-xs font-semibold text-amber-500">Coin</span></p></div>
              </div>
              {eventReward !== null && draft.event_name.trim() === '' && <p className="mt-2 text-[10px] font-medium text-amber-500">Isi nama event agar bonus khusus dapat disimpan.</p>}
              {!validEventReward && <p className="mt-2 text-xs font-medium text-red-400">Bonus event harus antara 1 sampai 100.000 Edu Coin.</p>}
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-fg-muted"><Info size={15} className="mt-0.5 shrink-0 text-amber-400"/><p><strong className="text-fg">Perlindungan nominal lama:</strong> nominal reward disalin ke catatan referral saat akun baru dibuat. Mengubah reward normal, jadwal, atau bonus event tidak mengubah nominal referral yang sudah tercatat maupun transaksi Edu Coin yang sudah diberikan.</p></div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"><Button size="sm" variant="outline" onClick={() => void load()} disabled={saving}>Muat Ulang</Button><Button size="sm" onClick={() => void save()} disabled={saving || !validReward || !validEventReward || !validDates || (eventReward !== null && !draft.event_name.trim()) || !dirty} loading={saving} icon={<Save size={14}/>}>Simpan Pengaturan</Button></div>
          </div>
        )}
      </Card>

      <Card className="flex items-start gap-3 p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><ShieldCheck size={17}/></span><div><h3 className="text-xs font-bold text-fg">Validasi di sisi server</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Hanya admin yang dapat mengubah pengaturan ini. Nominal aktual ditentukan oleh database saat referral dibuat, lalu backend yang memberikan Edu Coin ketika syarat referral terpenuhi.</p></div></Card>
    </div>
  );
}

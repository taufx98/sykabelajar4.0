import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, CircleCheck, Clock3, Copy, Gift, Link2, Share2, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';

type ReferralRow = {
  referred_user_id: string;
  full_name: string;
  username: string | null;
  joined_at: string;
  status: 'PENDING' | 'VERIFIED' | 'CREDITED' | 'REVOKED' | 'EXPIRED' | string;
  verified_at: string | null;
  verified_activity: string | null;
  reward_amount: number | string;
};

type ReferralProgram = {
  is_active: boolean;
  reward_amount: number;
  base_reward_amount: number;
  event_reward_amount: number | null;
  is_event_active: boolean;
  event_name: string | null;
  event_description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_available: boolean;
};

function formatActivity(value: string | null) {
  const labels: Record<string, string> = {
    daily_checkin: 'Check-in harian',
    comment: 'Membuat komentar',
    follow: 'Mengikuti pengguna',
    chat: 'Mengirim pesan chat',
    daily_task: 'Menyelesaikan tugas harian',
  };
  return value ? labels[value] ?? value : '';
}

function statusLabel(row: ReferralRow) {
  if (row.status === 'CREDITED') return 'Reward diberikan';
  if (row.status === 'VERIFIED') return 'Berhasil';
  if (row.status === 'REVOKED') return 'Dibatalkan';
  if (row.status === 'EXPIRED') return 'Kedaluwarsa';
  return row.verified_activity ? 'Menunggu verifikasi email' : 'Menunggu aktivitas';
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ReferralProgramPanel() {
  const { user, toast } = useApp();
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [program, setProgram] = useState<ReferralProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const referralLink = useMemo(
    () => user?.id ? `${window.location.origin}/register?ref=${encodeURIComponent(user.id)}` : '',
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id) {
      setRows([]);
      setProgram(null);
      setLoading(false);
      return;
    }
    let active = true;
    let refreshTimer: number | undefined;

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const [referralResult, programResult] = await Promise.all([
          supabase.rpc('get_my_referrals_v2'),
          supabase.rpc('get_referral_program_settings'),
        ]);
        if (referralResult.error) throw referralResult.error;
        if (programResult.error) throw programResult.error;
        if (!active) return;
        setRows((referralResult.data ?? []) as ReferralRow[]);
        const settings = Array.isArray(programResult.data) ? programResult.data[0] : programResult.data;
        setProgram(settings ? settings as ReferralProgram : null);
      } catch (error) {
        if (active) toast(error instanceof Error ? error.message : 'Gagal memuat program referral.', 'error');
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };

    void load(true);
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void load(false);
      }, 250);
    };
    const channel = supabase.channel(`referral-events-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'referral_events',
        filter: `referrer_user_id=eq.${user.id}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  const successful = rows.filter((row) => row.status === 'VERIFIED' || row.status === 'CREDITED').length;
  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const rewardEarned = rows
    .filter((row) => row.status === 'VERIFIED' || row.status === 'CREDITED')
    .reduce((sum, row) => sum + Math.max(0, Number(row.reward_amount) || 0), 0);
  const reward = Math.max(0, Number(program?.reward_amount) || 0);

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast('Link referral berhasil disalin.', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Link belum dapat disalin. Silakan pilih dan salin dari kolom tautan.', 'error');
    }
  };

  const shareLink = async () => {
    if (!referralLink) return;
    const shareData = {
      title: 'Gabung SYKABELAJAR',
      text: 'Yuk bergabung di SYKABELAJAR melalui link undanganku. Atribusi referral akan tercatat otomatis saat kamu membuat akun.',
      url: referralLink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    await copyLink();
  };

  const programDates = [
    program?.event_reward_amount != null && program.starts_at ? `Mulai ${formatDate(program.starts_at)}` : null,
    program?.event_reward_amount != null && program.ends_at ? `Berakhir ${formatDate(program.ends_at)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-[#3B82F6]/30 bg-gradient-to-br from-[#1E3A8A]/70 via-[#111C33] to-[#1E1B4B]/70 p-6 shadow-xl shadow-blue-950/20 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-8 h-64 w-64 rounded-full bg-[#3B82F6]/15 blur-3xl"/>
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl"/>
        <div className="relative z-10 max-w-2xl space-y-3">
          <span className="inline-flex rounded-full border border-[#60A5FA]/30 bg-[#3B82F6]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#93C5FD]">SYKABELAJAR COMMUNITY</span>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Ajak teman, dapatkan reward <span className="text-[#60A5FA]">Edu Coin</span> bersama!</h2>
          <p className="max-w-xl text-xs leading-relaxed text-slate-300 sm:text-sm">Bagikan link undangan pribadi kamu. Temanmu mendapat akses belajar SYKABELAJAR, sementara referral tercatat otomatis ketika akun dibuat.</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge color={!program?.is_available ? 'warn' : program.is_event_active ? 'moss' : 'info'}>{!program?.is_available ? 'Program nonaktif' : program.is_event_active ? 'Bonus event aktif' : 'Reward normal aktif'}</Badge>
            {program?.is_event_active && program.event_name && <span className="text-xs font-semibold text-[#BFDBFE]">{program.event_name}</span>}
            {programDates && <span className="text-[11px] text-slate-400">{programDates}</span>}
          </div>
          {program?.is_event_active && program.event_description && <p className="max-w-xl text-xs leading-relaxed text-slate-300">{program.event_description}</p>}
        </div>
      </section>

      {program && !program.is_available && !loading && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-relaxed text-fg-muted">
          <Clock3 size={17} className="mt-0.5 shrink-0 text-amber-400"/>
          <p>Program referral sedang dinonaktifkan oleh admin. Link dan riwayat tetap dapat dilihat, tetapi referral baru tidak dicatat sampai program diaktifkan kembali.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="relative flex flex-col justify-between overflow-hidden border-amber-500/20 bg-white p-5 dark:border-[#1E293B] dark:bg-[#151E32]">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl"/>
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-500"><Gift size={22}/></div>
            <div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{program?.is_event_active ? 'Reward Event Referral' : 'Reward Normal Referral'}</span>
              <p className="mt-0.5 text-2xl font-black text-slate-900 dark:text-white">{loading ? '—' : reward.toLocaleString('id-ID')} <span className="text-sm font-bold text-amber-500">Edu Coin</span></p>
            </div>
          </div>
          <p className="relative mt-4 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-[#1E293B] dark:text-slate-400">Nominal yang berlaku untuk referral baru selama program aktif. Reward referral yang sudah tercatat tidak berubah.</p>
        </Card>

        <Card className="space-y-3 border-[#3B82F6]/20 bg-white p-5 dark:border-[#1E293B] dark:bg-[#151E32] lg:col-span-2">
          <label htmlFor="referral-share-link" className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200"><Link2 size={15} className="text-[#3B82F6]"/> Link Undangan Pribadi</label>
          <input id="referral-share-link" readOnly value={referralLink} onFocus={(event) => event.currentTarget.select()} className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11px] text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] dark:border-[#334155] dark:bg-[#0B1120]/80 dark:text-slate-300"/>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button fullWidth onClick={() => void copyLink()} icon={copied ? <Check size={15}/> : <Copy size={15}/>}>{copied ? 'Link tersalin' : 'Salin Link'}</Button>
            <Button fullWidth variant="outline" onClick={() => void shareLink()} icon={<Share2 size={15}/>}>Bagikan</Button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Atribusi dicatat oleh backend saat teman membuat akun melalui tautan ini. UID tidak perlu disalin atau dimasukkan secara manual.</p>
        </Card>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-4"><div className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Users size={17}/></span><span className="text-[10px] font-medium sm:text-xs">Total Undangan</span></div><p className="mt-3 text-xl font-bold tabular-nums text-slate-900 dark:text-white">{loading ? '—' : rows.length}<span className="ml-1 text-[10px] font-normal text-slate-500">Orang</span></p></Card>
        <Card className="p-3 sm:p-4"><div className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><CircleCheck size={17}/></span><span className="text-[10px] font-medium sm:text-xs">Berhasil</span></div><p className="mt-3 text-xl font-bold tabular-nums text-emerald-500">{loading ? '—' : successful}<span className="ml-1 text-[10px] font-normal text-slate-500">Orang</span></p></Card>
        <Card className="p-3 sm:p-4"><div className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><Wallet size={17}/></span><span className="text-[10px] font-medium sm:text-xs">Reward Diperoleh</span></div><p className="mt-3 text-xl font-bold tabular-nums text-amber-500">{loading ? '—' : rewardEarned.toLocaleString('id-ID')}<span className="ml-1 text-[10px] font-normal text-slate-500">Coin</span></p></Card>
      </section>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/10 text-[#3B82F6]"><CircleCheck size={19}/></span><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Cara Kerja Referral</h3><p className="text-xs text-slate-500 dark:text-slate-400">Tiga langkah sederhana</p></div></div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ['1', 'Bagikan Link', 'Sebarkan link undangan pribadi kamu kepada teman atau melalui media sosial.'],
            ['2', 'Teman Mendaftar', 'Temanmu membuat akun melalui link undangan. Referral tercatat otomatis saat akun dibuat.'],
            ['3', 'Dapatkan Reward', 'Teman memverifikasi email dan melakukan aktivitas yang memenuhi syarat dalam 24 jam.'],
          ].map(([number, title, description]) => <div key={number} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1E293B] dark:bg-[#0B1120]/50"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3B82F6]/15 text-xs font-bold text-[#3B82F6]">{number}</span><h4 className="text-xs font-bold text-slate-900 dark:text-white">{title}</h4><p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p></div>)}
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300"><p className="font-bold text-slate-900 dark:text-white">Kapan reward diberikan?</p><p className="mt-1">Setelah email teman terverifikasi dan aktivitas pertamanya tercatat. Aktivitas yang diterima: check-in harian, komentar, mengikuti pengguna, mengirim pesan, atau menyelesaikan tugas harian. Satu akun hanya dapat dihitung satu kali.</p>{pending > 0 && <p className="mt-2 font-semibold text-amber-500">{pending} referral masih menunggu persyaratan.</p>}</div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Aktivitas Referral Terbaru</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pantau teman yang bergabung melalui undanganmu.</p></div><Badge color="moss">{rows.length} teman</Badge></div>
        {loading && <Card className="p-8 text-center text-sm text-fg-muted">Memuat aktivitas referral…</Card>}
        {!loading && rows.length === 0 && <Card className="p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><Users size={21}/></div><p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Belum ada referral</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">Bagikan link undanganmu. Teman yang mendaftar melalui link tersebut akan muncul di sini.</p></Card>}
        {!loading && rows.map((row) => {
          const verified = row.status === 'VERIFIED' || row.status === 'CREDITED';
          return <Card key={row.referred_user_id} className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3B82F6]/10 text-xs font-bold text-[#3B82F6]">{String(row.full_name || row.username || 'P').slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-900 dark:text-white">{row.full_name}</p><p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">@{row.username || 'pengguna'}</p><p className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400"><CalendarClock size={11}/> Bergabung {formatDate(row.joined_at)}</p>{row.verified_activity && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Aktivitas: {formatActivity(row.verified_activity)}</p>}</div>
              </div>
              <div className="shrink-0 text-right"><Badge color={verified ? 'moss' : row.status === 'EXPIRED' || row.status === 'REVOKED' ? 'err' : 'warn'}>{statusLabel(row)}</Badge>{verified && <p className="mt-1 text-[10px] font-bold text-emerald-500">+{Number(row.reward_amount).toLocaleString('id-ID')} Edu Coin</p>}</div>
            </div>
          </Card>;
        })}
      </section>
    </div>
  );
}

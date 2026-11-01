import { useEffect, useMemo, useState } from 'react';
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
  useEffect(() => {
    const existing = document.getElementById('syka-notification-fontawesome') as HTMLLinkElement | null;
    if (existing) return;

    const stylesheet = document.createElement('link');
    stylesheet.id = 'syka-notification-fontawesome';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    stylesheet.referrerPolicy = 'no-referrer';
    document.head.appendChild(stylesheet);
  }, []);

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
    let boundaryTimer: number | undefined;

    const scheduleBoundaryRefresh = (settings: ReferralProgram | null) => {
      if (boundaryTimer) window.clearTimeout(boundaryTimer);
      boundaryTimer = undefined;
      if (!settings?.is_active || !settings.event_reward_amount) return;
      const now = Date.now();
      const nextBoundary = [settings.starts_at, settings.ends_at]
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value) && value > now)
        .sort((left, right) => left - right)[0];
      if (nextBoundary === undefined) return;
      const delay = Math.min(Math.max(nextBoundary - now + 1000, 1000), 2_147_483_647);
      boundaryTimer = window.setTimeout(() => {
        boundaryTimer = undefined;
        void load(false);
      }, delay);
    };

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
        const nextSettings = settings ? settings as ReferralProgram : null;
        setProgram(nextSettings);
        scheduleBoundaryRefresh(nextSettings);
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
    const handleWindowFocus = () => scheduleRefresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const channel = supabase.channel(`referral-events-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'referral_events',
        filter: `referrer_user_id=eq.${user.id}`,
      }, scheduleRefresh)
      .subscribe();
    const campaignChannel = supabase.channel('referral-program-settings', { config: { private: false } })
      .on('broadcast', { event: 'updated' }, scheduleRefresh)
      .subscribe();

    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (boundaryTimer) window.clearTimeout(boundaryTimer);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(campaignChannel);
    };
  }, [user?.id, toast]);

  const successful = rows.filter((row) => row.status === 'VERIFIED' || row.status === 'CREDITED').length;
  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const rewardEarned = rows
    .filter((row) => row.status === 'VERIFIED' || row.status === 'CREDITED')
    .reduce((sum, row) => sum + Math.max(0, Number(row.reward_amount) || 0), 0);
  const reward = Math.max(0, Number(program?.reward_amount) || 0);
  const eventUpcoming = Boolean(
    program?.is_active
    && program.event_reward_amount != null
    && program.starts_at
    && Date.now() < new Date(program.starts_at).getTime()
  );

  const referralMilestones = [
    { target: 1, title: 'Target Pertama', amount: '5 Coin', bonus: null, totalNote: null, ultra: false },
    { target: 25, title: 'Progress Konsisten', amount: '145 Coin', bonus: '+20 Bonus', totalNote: null, ultra: false },
    { target: 100, title: 'Komunitas Berkembang', amount: '650 Coin', bonus: '+150 Coin Bonus', totalNote: null, ultra: false },
    { target: 1000, title: 'Target Komunitas', amount: '950 Coin', bonus: '+250 Bonus Coin', totalNote: '(700 + 250)', ultra: true },
  ] as const;
  const nextMilestone = referralMilestones.find((milestone) => successful < milestone.target);

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

  const shareMessage = 'Yuk bergabung di SYKABELAJAR melalui link undanganku!';
  const whatsappShareUrl = referralLink
    ? `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage + ' ' + referralLink)}`
    : undefined;
  const telegramShareUrl = referralLink
    ? `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareMessage)}`
    : undefined;

  const programDates = [
    program?.is_available && (program.is_event_active || eventUpcoming) && program.starts_at ? `Mulai ${formatDate(program.starts_at)}` : null,
    program?.is_available && (program.is_event_active || eventUpcoming) && program.ends_at ? `Berakhir ${formatDate(program.ends_at)}` : null,
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
            <Badge color={!program?.is_available ? 'warn' : program.is_event_active ? 'moss' : eventUpcoming ? 'info' : 'info'}>{!program?.is_available ? 'Program nonaktif' : program.is_event_active ? 'Bonus event aktif' : eventUpcoming ? 'Event segera dimulai' : 'Reward normal aktif'}</Badge>
            {program?.event_reward_amount != null && (program.is_event_active || eventUpcoming) && program.event_name && <span className="text-xs font-semibold text-[#BFDBFE]">{program.event_name}</span>}
            {programDates && <span className="text-[11px] text-slate-400">{programDates}</span>}
          </div>
          {program?.event_reward_amount != null && (program.is_event_active || eventUpcoming) && program.event_description && <p className="max-w-xl text-xs leading-relaxed text-slate-300">{program.event_description}</p>}
        </div>
      </section>

      {program && !program.is_available && !loading && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-relaxed text-fg-muted">
          <i aria-hidden="true" className="fa-solid fa-clock mt-0.5 shrink-0 text-amber-400"/>
          <p>Program referral sedang dinonaktifkan oleh admin. Link dan riwayat tetap dapat dilihat, tetapi referral baru tidak dicatat sampai program diaktifkan kembali.</p>
        </div>
      )}

      <Card className="referral-link-card space-y-3 border-[#3B82F6]/20 bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#151E32] sm:p-6">
        <label htmlFor="referral-share-link" className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700 dark:text-slate-200">
          <span className="flex items-center gap-2"><i aria-hidden="true" className="fa-solid fa-link text-[#3B82F6]"/> Link Undangan Pribadi</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#10B981]/20 bg-[#10B981]/10 px-2 py-0.5 text-[10px] font-semibold text-[#34D399]">
            <i aria-hidden="true" className="fa-solid fa-circle-check"/> Akun Terhubung
          </span>
        </label>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row">
          <input id="referral-share-link" readOnly value={referralLink} onFocus={(event) => event.currentTarget.select()} className="w-full min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11px] text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] dark:border-[#334155] dark:bg-[#0B1120]/80 dark:text-slate-300"/>
          <Button className="shrink-0 sm:min-w-[132px]" onClick={() => void copyLink()} icon={copied ? <i aria-hidden="true" className="fa-solid fa-check"/> : <i aria-hidden="true" className="fa-solid fa-copy"/>}>{copied ? 'Link tersalin' : 'Salin Link'}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="mr-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Bagikan cepat:</span>
          <a href={whatsappShareUrl} target="_blank" rel="noopener noreferrer" aria-disabled={!whatsappShareUrl} className={['inline-flex items-center gap-1.5 rounded-lg bg-[#10B981]/10 px-3 py-2 text-xs font-semibold text-[#34D399] transition hover:bg-[#10B981]/20', !whatsappShareUrl ? 'pointer-events-none opacity-50' : ''].join(' ')}>
            <i aria-hidden="true" className="fa-brands fa-whatsapp"/> WhatsApp
          </a>
          <a href={telegramShareUrl} target="_blank" rel="noopener noreferrer" aria-disabled={!telegramShareUrl} className={['inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-500 transition hover:bg-sky-500/20', !telegramShareUrl ? 'pointer-events-none opacity-50' : ''].join(' ')}>
            <i aria-hidden="true" className="fa-brands fa-telegram"/> Telegram
          </a>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Atribusi dicatat oleh backend saat teman membuat akun melalui tautan ini. UID tidak perlu disalin atau dimasukkan secara manual.</p>
      </Card>

      <section className="referral-reward-tiers space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#151E32] sm:p-6">
        <div className="rounded-xl border border-amber-500/25 bg-slate-50 p-4 dark:border-amber-500/25 dark:bg-slate-900/70">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-gradient-to-tr from-amber-500/20 to-yellow-500/10 text-xl text-amber-500">
                <i aria-hidden="true" className="fa-solid fa-gift"/>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{program?.is_event_active ? 'Reward Event Referral' : 'Reward Dasar'}</span>
                <p className="text-base font-extrabold text-slate-900 dark:text-white">
                  {loading ? '—' : reward.toLocaleString('id-ID')} <span className="text-sm font-bold text-amber-500">Edu Coin</span>
                  <span className="ml-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">/ referral memenuhi syarat</span>
                </p>
                {program?.event_name && program.is_event_active && <p className="mt-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-300">{program.event_name}</p>}
              </div>
            </div>
            <Badge color={program?.is_available ? program.is_event_active ? 'moss' : 'info' : 'warn'}>
              {loading ? 'Memuat reward' : !program?.is_available ? 'Program nonaktif' : program.is_event_active ? 'Bonus event aktif' : 'Reward otomatis'}
            </Badge>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                <i aria-hidden="true" className="fa-solid fa-chart-line text-[#3B82F6]"/> Target Undangan & Progress
              </h3>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Milestone dihitung dari jumlah referral yang berhasil terverifikasi.</p>
            </div>
            <span className="inline-flex w-fit rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-500">
              {loading ? 'Memuat progress…' : nextMilestone ? `Progress Saat Ini: ${successful.toLocaleString('id-ID')} / ${nextMilestone.target.toLocaleString('id-ID')} User` : 'Semua target tercapai'}
            </span>
          </div>

          <div className="referral-milestones grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {referralMilestones.map((milestone, index) => {
              const achieved = successful >= milestone.target;
              const previousTarget = index === 0 ? 0 : referralMilestones[index - 1].target;
              const inProgress = !achieved && successful >= previousTarget;
              const locked = !achieved && !inProgress;
              const stateClass = achieved
                ? 'border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/5'
                : inProgress
                  ? 'border-amber-500/40 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                  : 'border-dashed border-slate-700/80 bg-slate-900/40 opacity-70 hover:opacity-100';
              const titleClass = locked ? 'text-slate-300' : 'text-white';
              const description = index === 0
                ? achieved ? 'Target Pertama · Achieved' : 'Target Pertama'
                : index === 1
                  ? achieved ? 'Target Tercapai' : inProgress ? `Berjalan (${successful.toLocaleString('id-ID')}/25 User)` : milestone.title
                  : milestone.bonus;
              return (
                <div
                  key={milestone.target}
                  className={[
                    'flex items-center justify-between gap-3 rounded-xl border p-3 transition-all duration-300',
                    inProgress && index === 1 ? 'animate-pulse motion-reduce:animate-none' : '',
                    stateClass,
                  ].join(' ')}
                  data-referral-tier={milestone.target}
                  aria-label={`Target ${milestone.target.toLocaleString('id-ID')} referral: ${achieved ? 'tercapai' : inProgress ? 'sedang berjalan' : 'terkunci'}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={[
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold',
                      achieved
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : inProgress
                          ? 'border border-amber-500/60 bg-amber-500/20 text-amber-400'
                          : 'border border-slate-700/60 bg-slate-800/80 text-slate-400',
                    ].join(' ')}>
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className={['text-xs font-bold', titleClass].join(' ')}>{milestone.target.toLocaleString('id-ID')} User</p>
                        {milestone.ultra && (
                          <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1 py-0.5 text-[8px] font-bold text-amber-400/90">ULTRA</span>
                        )}
                        {achieved && <i aria-hidden="true" className="fa-solid fa-circle-check text-[10px] text-amber-400"/>}
                        {inProgress && index === 1 && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-400 motion-reduce:animate-none"/>}
                        {locked && <i aria-hidden="true" className="fa-solid fa-lock text-[9px] text-slate-500"/>}
                      </div>
                      <p className={[
                        'text-[10px] font-medium leading-relaxed',
                        achieved || inProgress ? 'text-amber-300' : 'text-slate-400',
                      ].join(' ')}>
                        {description}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={[
                      'inline-block whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-extrabold',
                      achieved || inProgress
                        ? 'border border-amber-500/40 bg-amber-500/20 text-amber-400'
                        : 'border border-slate-700/60 bg-slate-800/60 text-slate-400',
                    ].join(' ')}>
                      {milestone.amount}
                    </span>
                    {milestone.target === 25 && (
                      <span className="mt-1 block text-[9px] font-medium text-emerald-400">+20 Bonus</span>
                    )}
                    {milestone.target === 100 && (
                      <span className="mt-1 block text-[9px] font-medium text-slate-400">+150 Coin Bonus</span>
                    )}
                    {milestone.totalNote && (
                      <span className="mt-1 block whitespace-nowrap text-[9px] text-slate-500">{milestone.totalNote}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Target dan nominal tier ditampilkan mengikuti referensi. Reward per referral yang benar-benar masuk tetap menggunakan nominal program aktif dan catatan transaksi backend.
        </p>
      </section>

      <section className="referral-stats grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4 border-slate-200 bg-white p-4 dark:border-slate-800/80 dark:bg-[#151E32]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <i aria-hidden="true" className="fa-solid fa-users"/>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Undangan</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900 dark:text-white">{loading ? '—' : rows.length} <span className="text-xs font-normal text-slate-500">Orang</span></p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 border-slate-200 bg-white p-4 dark:border-slate-800/80 dark:bg-[#151E32]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
            <i aria-hidden="true" className="fa-solid fa-user-check"/>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Berhasil Terverifikasi</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-500 dark:text-emerald-400">{loading ? '—' : successful} <span className="text-xs font-normal text-slate-500">Orang</span></p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 border-slate-200 bg-white p-4 dark:border-slate-800/80 dark:bg-[#151E32]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400">
            <i aria-hidden="true" className="fa-solid fa-coins"/>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Reward Diperoleh</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-amber-500 dark:text-amber-400">{loading ? '—' : rewardEarned.toLocaleString('id-ID')} <span className="text-xs font-normal text-slate-500">Coin</span></p>
          </div>
        </Card>
      </section>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/10 text-[#3B82F6]"><i aria-hidden="true" className="fa-solid fa-circle-check"/></span><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Cara Kerja Referral</h3><p className="text-xs text-slate-500 dark:text-slate-400">Tiga langkah sederhana</p></div></div>
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
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Aktivitas Referral Terbaru</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pantau teman yang bergabung melalui undanganmu.</p>
          </div>
          <Badge color="moss">{loading ? 'Memuat…' : `${successful.toLocaleString('id-ID')} teman berhasil`}</Badge>
        </div>

        {loading && <Card className="p-8 text-center text-sm text-fg-muted">Memuat aktivitas referral…</Card>}
        {!loading && rows.length === 0 && (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <i aria-hidden="true" className="fa-solid fa-users text-xl"/>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Belum ada referral</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">Bagikan link undanganmu. Teman yang mendaftar melalui link tersebut akan muncul di sini.</p>
          </Card>
        )}
        {!loading && rows.length > 0 && (
          <Card className="overflow-hidden p-0">
            <div className="referral-activity-table overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <th className="px-4 py-3">No</th>
                    <th className="px-4 py-3">Nama</th>
                    <th className="px-4 py-3">Tanggal Gabung</th>
                    <th className="px-4 py-3 text-right">Reward & Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs dark:divide-slate-800/80">
                  {rows.map((row, index) => {
                    return (
                      <tr key={row.referred_user_id} className="transition hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 dark:text-white">{row.full_name || row.username || 'Pengguna'}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">@{row.username || 'pengguna'}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(row.joined_at)}</td>
                        <td className="px-4 py-3 text-right">
                          {row.status === 'CREDITED' ? (
                            <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 dark:text-emerald-400">
                              +{Math.max(0, Number(row.reward_amount) || 0).toLocaleString('id-ID')} Edu Coin · Selesai
                            </span>
                          ) : row.status === 'VERIFIED' ? (
                            <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 dark:text-emerald-400">
                              Terverifikasi
                            </span>
                          ) : (
                            <Badge color={row.status === 'EXPIRED' || row.status === 'REVOKED' ? 'err' : 'warn'}>{statusLabel(row)}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

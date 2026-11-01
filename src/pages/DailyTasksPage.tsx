import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Award,
  CalendarCheck,
  CalendarDays,
  Check,
  Clock,
  Coins,
  Flame,
  Gift,
  Info,
  ListChecks,
  Loader2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { claimAndCompleteDailyTask, getDailyTasks, type LiveDailyTask } from '@/services/daily-task.service';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/LanguageContext';
import { getJakartaDateKey, getPreviousJakartaDateKey } from '@/lib/jakartaDate';
import { subscribeSykaEvents } from '@/lib/realtimeBus';
import { ReferralProgramPanel } from '@/components/referrals/ReferralProgramPanel';

type CheckinRecord = {
  checkin_date: string;
  streak_day: number;
  reward_type?: string;
  reward_amount?: number | string;
};

type CheckinRewardDay = {
  day_number: number;
  reward_type: string;
  reward_amount: number | string;
  coin_amount: number | string;
  sparkle?: boolean;
};

export function DailyTasksPage() {
  const { toast, user, refreshUser } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'referral' ? 'referral' : 'tasks';
  const [displayedTab, setDisplayedTab] = useState<'tasks' | 'referral'>(activeTab);
  const [tabContentVisible, setTabContentVisible] = useState(true);
  const [referralReward, setReferralReward] = useState<number | null>(null);
  const [referralProgramActive, setReferralProgramActive] = useState(false);
  const { language } = useLanguage();
  const text = (id: string, en: string) => language === 'en' ? en : id;

  const [todayKey, setTodayKey] = useState(() => getJakartaDateKey());
  const [tasks, setTasks] = useState<LiveDailyTask[]>([]);
  const [checkin, setCheckin] = useState<Record<string, unknown> | null>(null);
  const [checkinHistory, setCheckinHistory] = useState<CheckinRecord[]>([]);
  const [lastCheckin, setLastCheckin] = useState<CheckinRecord | null>(null);
  const [walletCoin, setWalletCoin] = useState(0);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(false);

  useEffect(() => {
    if (displayedTab === activeTab) {
      setTabContentVisible(true);
      return;
    }

    setTabContentVisible(false);
    let animationFrame: number | undefined;
    const transitionTimer = window.setTimeout(() => {
      setDisplayedTab(activeTab);
      animationFrame = window.requestAnimationFrame(() => setTabContentVisible(true));
    }, 150);

    return () => {
      window.clearTimeout(transitionTimer);
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    };
  }, [activeTab, displayedTab]);

  // Refresh the calendar key while the page stays open across 00:00 WIB.
  useEffect(() => {
    const refreshJakartaDate = () => {
      const currentKey = getJakartaDateKey();
      setTodayKey((previousKey) => previousKey === currentKey ? previousKey : currentKey);
    };
    const timer = window.setInterval(refreshJakartaDate, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setReferralReward(null);
      setReferralProgramActive(false);
      return;
    }

    let live = true;
    const loadReferralReward = async () => {
      const { data, error: requestError } = await supabase.rpc('get_referral_program_settings_v2');
      if (!live || requestError) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object') return;

      const settings = row as Record<string, unknown>;
      setReferralReward(Math.max(0, Number(settings.reward_amount) || 0));
      setReferralProgramActive(Boolean(settings.is_active));
    };

    const channel = supabase.channel('referral-program-settings', { config: { private: false } })
      .on('broadcast', { event: 'updated' }, () => { void loadReferralReward(); })
      .subscribe();

    void loadReferralReward();
    return () => {
      live = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const switchTab = (tab: 'tasks' | 'referral') => {
    setSearchParams(tab === 'tasks' ? {} : { tab: 'referral' }, { replace: true });
  };

  useEffect(() => {
    if (!user?.id) return;

    return subscribeSykaEvents((event) => {
      if (event.type !== 'profile-updated' || event.userId !== user.id) return;
      void supabase.from('profiles')
        .select('edu_coin')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data, error: walletError }) => {
          if (!walletError) setWalletCoin(Math.max(0, Number(data?.edu_coin) || 0));
        });
      void refreshUser();
    });
  }, [refreshUser, user?.id]);

  const load = useCallback(async () => {
    if (!user?.id) {
      setTasks([]);
      setCheckin(null);
      setCheckinHistory([]);
      setLastCheckin(null);
      setWalletCoin(0);
      setChecked(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextTasks, todayCheckinResult, historyResult, walletResult, rewardScheduleResult] = await Promise.all([
        getDailyTasks(todayKey),
        supabase.from('daily_checkins')
          .select('checkin_date, streak_day, reward_type, reward_amount')
          .eq('user_id', user.id)
          .eq('checkin_date', todayKey)
          .maybeSingle(),
        supabase.from('daily_checkins')
          .select('checkin_date, streak_day, reward_type, reward_amount')
          .eq('user_id', user.id)
          .order('checkin_date', { ascending: false })
          .limit(14),
        supabase.from('profiles')
          .select('edu_coin')
          .eq('id', user.id)
          .maybeSingle(),
        supabase.rpc('get_daily_checkin_streak_rewards', { p_date: todayKey }),
      ]);

      if (todayCheckinResult.error) throw todayCheckinResult.error;
      if (historyResult.error) throw historyResult.error;
      if (walletResult.error) throw walletResult.error;
      if (rewardScheduleResult.error) throw rewardScheduleResult.error;

      const nextHistory = (historyResult.data ?? []) as CheckinRecord[];
      const latest = nextHistory[0] ?? null;
      const previousDateKey = getPreviousJakartaDateKey(todayKey);
      const expectedDay = todayCheckinResult.data
        ? Number(todayCheckinResult.data.streak_day) || 1
        : latest?.checkin_date === previousDateKey
          ? (Number(latest.streak_day) || 0) + 1
          : 1;
      const rewardSchedule = Array.isArray(rewardScheduleResult.data)
        ? rewardScheduleResult.data as CheckinRewardDay[]
        : [];
      const currentReward = rewardSchedule.find((item) => Number(item.day_number) === expectedDay)
        ?? rewardSchedule[0]
        ?? null;

      setTasks(nextTasks);
      setChecked(Boolean(todayCheckinResult.data));
      setCheckinHistory(nextHistory);
      setLastCheckin(latest);
      setWalletCoin(Math.max(0, Number(walletResult.data?.edu_coin) || 0));
      setCheckin({
        ...(currentReward ?? {}),
        day_rewards: rewardSchedule,
        streak_day: todayCheckinResult.data?.streak_day ?? expectedDay,
      });
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'Daily Tasks gagal dimuat.';
      setError(message);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [todayKey, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const completedCount = useMemo(() => tasks.filter((task) => task.completed).length, [tasks]);
  const currentStreak = useMemo(() => {
    if (!lastCheckin) return 0;
    const previousDateKey = getPreviousJakartaDateKey(todayKey);
    if (lastCheckin.checkin_date !== todayKey && lastCheckin.checkin_date !== previousDateKey) return 0;
    return Math.max(0, Number(lastCheckin.streak_day) || 0);
  }, [lastCheckin, todayKey]);

  const taskXp = useMemo(
    () => tasks.filter((task) => task.completed).reduce((sum, task) => sum + task.exp, 0),
    [tasks],
  );
  const checkinXp = checked && String(checkin?.reward_type ?? 'XP') === 'XP'
    ? Number(checkin?.reward_amount ?? 0)
    : 0;
  const totalXp = taskXp + checkinXp;
  const checkinProgress = tasks.length > 0 ? Math.round(completedCount / tasks.length * 100) : 0;
  const rewardType = String(checkin?.reward_type ?? 'XP');
  const rewardAmount = Number(checkin?.reward_amount ?? 0);
  const coinReward = rewardType === 'COIN' ? rewardAmount : Number(checkin?.coin_amount ?? 0);
  const checkinDay = Number(checkin?.streak_day ?? (currentStreak + 1)) || 1;
  const eventActive = Boolean(checkin?.event_name);
  const borderClass = checkin?.frame_style === 'red-white'
    ? 'border-red-400/50'
    : checkin?.frame_style === 'gold-glow'
      ? 'border-amber-300/50 shadow-[0_0_24px_rgba(251,191,36,.12)]'
      : 'border-amber-500/50';

  const claimCheckin = async () => {
    if (busyId !== null || checked) return;
    setBusyId('checkin');
    try {
      const { data, error: rpcError } = await supabase.rpc('claim_daily_checkin', { p_date: todayKey });
      if (rpcError) throw rpcError;
      if (data?.already) {
        toast(text('Check-in hari ini sudah tercatat.', 'Today’s check-in is already recorded.'), 'info');
        await load();
        return;
      }

      const streak = Number(data?.streak_day || checkinDay);
      const claimedType = String(data?.reward_type || rewardType);
      const reward = Number(data?.reward_amount || 0);
      const coin = claimedType === 'COIN' ? 0 : Number(data?.coin_amount || 0);
      toast(text(
        `Check-in hari ke-${streak} berhasil. +${reward} ${claimedType}${coin > 0 ? ` dan +${coin} Coin` : ''}.`,
        `Daily check-in #${streak} claimed. +${reward} ${claimedType}${coin > 0 ? ` and +${coin} Coins` : ''}.`,
      ), 'success');
      await Promise.all([load(), refreshUser()]);
    } catch (claimError: unknown) {
      toast(claimError instanceof Error ? claimError.message : 'Check-in gagal.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const claimTask = async (taskId: string) => {
    if (busyId !== null) return;
    setBusyId(taskId);
    try {
      const result = await claimAndCompleteDailyTask(taskId);
      if (result?.already) {
        toast(text('Task ini sudah selesai hari ini.', 'This task is already complete for today.'), 'info');
      } else {
        toast(text(
          `Task selesai. +${Number(result?.exp ?? 0)} XP dan +${Number(result?.points ?? 0)} Edu Coin.`,
          `Task completed. +${Number(result?.exp ?? 0)} XP and +${Number(result?.points ?? 0)} Edu Coins.`,
        ), 'success');
      }
      await Promise.all([load(), refreshUser()]);
    } catch (claimError: unknown) {
      const message = claimError instanceof Error ? claimError.message : 'Task gagal diselesaikan.';
      toast(
        message.includes('TASK_REQUIREMENT_NOT_MET')
          ? text('Syarat tugas belum terpenuhi. Selesaikan aktivitasnya terlebih dahulu.', 'The task requirements are not met yet. Complete the activity first.')
          : message,
        'error',
      );
    } finally {
      setBusyId(null);
    }
  };

  const currentRewardLabel = [
    rewardType === 'XP' && rewardAmount > 0 ? `+${rewardAmount} XP` : null,
    rewardType === 'COIN' && rewardAmount > 0 ? `+${rewardAmount} Edu Coin` : null,
    coinReward > 0 && rewardType !== 'COIN' ? `+${coinReward} Edu Coin` : null,
  ].filter((label): label is string => Boolean(label));

  return (
    <div className="daily-tasks-page min-h-full bg-[#F8FAFC] text-slate-700 dark:bg-[#0B1120] dark:text-slate-200">
      <div className="max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <section className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-[#1E293B] dark:bg-[#151E32] sm:flex-row">
          <div className="flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-[#1E293B] dark:bg-slate-900/60 sm:w-auto">
            <button
              id="tab-tasks-btn"
              type="button"
              onClick={() => switchTab('tasks')}
              aria-pressed={activeTab === 'tasks'}
              className={[
                'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-all duration-300 sm:flex-initial sm:px-5',
                activeTab === 'tasks'
                  ? 'scale-[1.02] bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-600/25'
                  : 'font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200',
              ].join(' ')}
            >
              <ListChecks size={14}/>
              <span>{text('Daily Tasks & Check-in', 'Daily Tasks & Check-in')}</span>
              <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                {Math.max(0, tasks.length - completedCount)} Task Aktif
              </span>
            </button>
            <button
              id="tab-referral-btn"
              type="button"
              onClick={() => switchTab('referral')}
              aria-pressed={activeTab === 'referral'}
              className={[
                'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-all duration-300 sm:flex-initial sm:px-5',
                activeTab === 'referral'
                  ? 'scale-[1.02] bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-600/25'
                  : 'font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200',
              ].join(' ')}
            >
              <Gift size={14} className={activeTab === 'referral' ? 'text-white' : 'text-[#60A5FA]'}/>
              <span>Program Referral</span>
              {referralProgramActive && referralReward !== null && (
                <span className="ml-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  +{referralReward.toLocaleString('id-ID')} Edu Coin
                </span>
              )}
            </button>
          </div>

          <div className="flex w-full items-center justify-center gap-3 px-3 py-1 text-xs sm:w-auto sm:justify-end">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
              <Flame size={13} className="text-amber-500"/>
              Streak: <strong className="text-slate-900 dark:text-white">{currentStreak} Hari</strong>
            </span>
            <span className="h-3 w-px bg-slate-300 dark:bg-slate-700"/>
            <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
              <Coins size={13} className="text-amber-500"/>
              Coin: <strong className="text-amber-600 dark:text-amber-400">{walletCoin.toLocaleString('id-ID')} EDU</strong>
            </span>
          </div>
        </section>

        <div className={['transition-all duration-300 ease-out', tabContentVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'].join(' ')}>
          {displayedTab === 'tasks' ? (
            <div className="space-y-6">
              <section
                className={[
                  'relative flex flex-col items-center justify-between gap-6 overflow-hidden rounded-3xl border p-5 shadow-2xl transition-all duration-300 sm:p-7 md:flex-row',
                  eventActive
                    ? `bg-gradient-to-r from-amber-950/40 via-slate-900 to-blue-950/60 ${borderClass}`
                    : 'border-amber-500/50 bg-gradient-to-r from-amber-950/40 via-slate-900 to-blue-950/60',
                ].join(' ')}
              >
                <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl"/>
                <div className="relative z-10 flex min-w-0 items-center gap-5">
                  {typeof checkin?.icon_url === 'string' && checkin.icon_url ? (
                    <img src={checkin.icon_url} alt="Ikon event check-in" className="h-16 w-16 shrink-0 rounded-2xl bg-slate-900/40 object-contain p-1"/>
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 shadow-lg shadow-amber-500/30">
                      <CalendarCheck size={30}/>
                    </div>
                  )}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-extrabold text-white sm:text-xl">Check-in Harian</h2>
                      <span className={[
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold',
                        checked
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/30 bg-amber-500/20 text-amber-300',
                      ].join(' ')}>
                        {checked ? <Check size={11}/> : <Clock size={11}/>}
                        {checked ? `Hari ke-${Number(checkin?.streak_day || 1)} Selesai` : `Hari ke-${checkinDay} Belum Di-Klaim`}
                      </span>
                      {eventActive && (
                        <Badge color="moss"><Sparkles size={10}/> {String(checkin?.event_name)}</Badge>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                      {typeof checkin?.event_description === 'string' && checkin.event_description
                        ? checkin.event_description
                        : text('Klaim hadiah reguler harianmu sekarang dan pertahankan streak check-in.', 'Claim your daily reward and keep your check-in streak going.')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {currentRewardLabel.length > 0 ? currentRewardLabel.map((label) => (
                        <span key={label} className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-300">
                          {label.includes('XP') ? <Sparkles size={11} className="mr-1 inline"/> : <Coins size={11} className="mr-1 inline"/>}
                          {label}
                        </span>
                      )) : (
                        <span className="text-xs font-semibold text-slate-400">{text('Hadiah mengikuti pengaturan check-in aktif.', 'Reward follows the active check-in settings.')}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="relative z-10 flex w-full shrink-0 items-center gap-2 md:w-auto">
                  {eventActive && (
                    <button
                      type="button"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-600 text-slate-300 transition hover:bg-slate-800"
                      onClick={() => setEventOpen(true)}
                      aria-label="Info event check-in"
                    >
                      <Info size={15}/>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={checked || busyId !== null || loading}
                    onClick={() => void claimCheckin()}
                    className={[
                      'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-xs font-black shadow-xl transition-all duration-300 md:flex-initial',
                      checked
                        ? 'cursor-default border border-slate-700 bg-slate-800 text-emerald-300 opacity-90'
                        : 'bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 shadow-amber-500/25 hover:from-amber-400 hover:to-yellow-300 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 motion-safe:hover:scale-[1.01]',
                    ].join(' ')}
                  >
                    {busyId === 'checkin' ? <Loader2 size={15} className="animate-spin"/> : checked ? <Check size={15}/> : <CalendarCheck size={15}/>}
                    {checked ? 'Sudah Check-in Hari Ini' : text('Klik untuk Check-In Hari Ini!', 'Check in today!')}
                  </button>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <Card className="space-y-4 border-slate-200 p-5 dark:border-[#1E293B] lg:col-span-2" data-testid="daily-checkin-streak-tracker">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Flame size={18} className="text-amber-500"/>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Aktivitas & Streak Check-in</h3>
                    </div>
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      Target Bonus: 7 Hari Streak
                    </span>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5 pt-1 sm:gap-2">
                    {Array.from({ length: 7 }, (_, index) => {
                      const day = index + 1;
                      const completed = day <= Math.min(currentStreak, 7);
                      const ready = !checked && currentStreak < 7 && day === currentStreak + 1;
                      let historicalDateKey: string | null = null;
                      if (completed && lastCheckin) {
                        historicalDateKey = lastCheckin.checkin_date;
                        for (let offset = day; offset < currentStreak; offset += 1) {
                          historicalDateKey = getPreviousJakartaDateKey(historicalDateKey);
                        }
                      }
                      const historical = historicalDateKey
                        ? checkinHistory.find((record) => record.checkin_date === historicalDateKey)
                        : undefined;
                      const rewardSchedule = Array.isArray(checkin?.day_rewards)
                        ? checkin.day_rewards as CheckinRewardDay[]
                        : [];
                      const scheduledReward = rewardSchedule.find((item) => Number(item.day_number) === day);
                      const scheduledType = String(scheduledReward?.reward_type ?? 'XP');
                      const scheduledAmount = Number(scheduledReward?.reward_amount ?? 0);
                      const scheduledCoin = Number(scheduledReward?.coin_amount ?? 0);
                      const label = historical
                        ? `+${Number(historical.reward_amount || 0)} ${historical.reward_type || 'XP'}`
                        : [
                            scheduledType === 'XP' && scheduledAmount > 0 ? `+${scheduledAmount} XP` : null,
                            scheduledType === 'COIN' && scheduledAmount > 0 ? `+${scheduledAmount} Edu Coin` : null,
                            scheduledCoin > 0 ? `+${scheduledCoin} Edu Coin` : null,
                          ].filter((value): value is string => Boolean(value)).join(' · ') || 'Hadiah belum diatur';
                      const locked = !completed && !ready;

                      return (
                        <div
                          key={day}
                          className={[
                            'space-y-1.5 rounded-xl border p-1.5 text-center sm:p-2.5',
                            completed
                              ? 'border-emerald-500/40 bg-emerald-500/10'
                              : ready
                                ? 'animate-pulse border-amber-500/60 bg-amber-500/10'
                                : 'border-dashed border-slate-300 bg-slate-50 opacity-70 dark:border-slate-700/80 dark:bg-slate-900/30',
                          ].join(' ')}
                        >
                          <span className={[
                            'block text-[9px] font-semibold sm:text-[10px]',
                            completed ? 'text-emerald-600 dark:text-emerald-400' : ready ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500',
                          ].join(' ')}>
                            Hari {day}
                          </span>
                          <div className={[
                            'mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold sm:h-7 sm:w-7',
                            completed
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : ready
                                ? 'border border-amber-500/50 bg-slate-800 text-amber-400'
                                : 'bg-slate-200 text-slate-500 dark:bg-slate-800',
                          ].join(' ')}>
                            {completed ? <Check size={13}/> : day === 7 ? <Award size={12}/> : day}
                          </div>
                          <span className={[
                            'block text-[8px] font-medium leading-tight sm:text-[9px]',
                            completed ? 'text-emerald-600 dark:text-emerald-400' : ready ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500',
                          ].join(' ')}>
                            {completed ? 'Selesai' : ready ? 'Siap Klaim' : locked ? label : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p className="border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
                    Status streak mengikuti catatan check-in yang tersimpan. Hari berikutnya dibuka setelah check-in hari ini berhasil.
                  </p>
                </Card>

                <Card className="flex flex-col justify-between space-y-4 border-slate-200 p-5 dark:border-[#1E293B]">
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <ListChecks size={16} className="text-[#3B82F6]"/>
                      Progres Tugas Hari Ini
                    </h3>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900/80">
                        <p className="text-[11px] font-medium text-slate-500">Task Selesai</p>
                        <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">
                          {completedCount} <span className="text-xs font-medium text-slate-500">/ {tasks.length}</span>
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900/80">
                        <p className="text-[11px] font-medium text-slate-500">XP Diperoleh</p>
                        <p className="mt-1 text-2xl font-black text-purple-600 dark:text-purple-400">+{totalXp.toLocaleString('id-ID')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800/80">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-500">Kelengkapan Harian</span>
                      <span className="text-[#2563EB]">{checkinProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-indigo-500 transition-all duration-300" style={{ width: `${checkinProgress}%` }}/>
                    </div>
                  </div>
                </Card>
              </div>

              <Card className="space-y-4 border-slate-200 p-5 dark:border-[#1E293B]">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <ListChecks size={16} className="text-[#3B82F6]"/>
                    Daftar Daily Task Aktif
                  </h3>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Reset otomatis setiap 00:00 WIB</span>
                </div>

                {loading && (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                    <Loader2 size={17} className="animate-spin"/>
                    Memuat data aktivitas...
                  </div>
                )}
                {error && !loading && (
                  <div className="flex flex-col items-center gap-3 py-7 text-center">
                    <p className="max-w-lg text-xs text-red-500 dark:text-red-300">{error}</p>
                    <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                      Muat ulang
                    </button>
                  </div>
                )}
                {!loading && !error && tasks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-900/30">
                    <CalendarDays size={24} className="mx-auto mb-2 text-slate-400"/>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Belum ada Daily Task aktif</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      Tugas akan muncul setelah admin menerbitkan aktivitas yang sedang berlaku.
                    </p>
                  </div>
                )}

                {!loading && !error && tasks.map((task, index) => {
                  const expires = task.endsAt ? new Date(task.endsAt) : null;
                  const isBusy = busyId === task.id;
                  const normalizedTaskType = task.taskType.toUpperCase();
                  const taskIcon = normalizedTaskType.includes('REFERRAL') ? <UserPlus size={18}/> : <ListChecks size={18}/>;
                  const taskTypeLabel = normalizedTaskType === 'DAILY_CHECKIN'
                    ? 'Check-in Harian'
                    : normalizedTaskType === 'PROFILE_COMPLETE'
                      ? 'Kelengkapan Profil'
                      : normalizedTaskType === 'VERIFIED_REFERRAL'
                        ? 'Referral Terverifikasi'
                        : 'Tugas Mandiri';

                  return (
                    <div
                      key={task.id}
                      className={[
                        'flex flex-col justify-between gap-4 rounded-xl border p-4 transition sm:flex-row sm:items-center',
                        task.completed
                          ? 'border-emerald-500/25 bg-slate-50/70 opacity-75 dark:bg-slate-900/30'
                          : index === 0
                            ? 'border-[#3B82F6]/30 bg-[#EFF6FF] dark:bg-slate-900/90'
                            : 'border-slate-200 bg-slate-50 dark:border-slate-800/80 dark:bg-slate-900/70',
                      ].join(' ')}
                    >
                      <div className="flex min-w-0 items-start gap-3.5">
                        <div className={[
                          'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg',
                          task.completed
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-[#3B82F6]/25 bg-[#3B82F6]/10 text-[#3B82F6]',
                        ].join(' ')}>
                          {taskIcon}
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{task.title}</h4>
                            <span className={[
                              'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                              task.completed
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                            ].join(' ')}>
                              {task.completed ? 'Selesai' : taskTypeLabel}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            {task.description || text('Aktivitas harian SYKABELAJAR.', 'Daily SYKABELAJAR activity.')}
                            {normalizedTaskType === 'DAILY' && (
                              <span className="mt-1 block text-[10px] text-amber-700 dark:text-amber-300">
                                {text('Klaim mandiri. Pastikan aktivitas sudah kamu lakukan.', 'Self-claimed task. Make sure you have completed the activity.')}
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[11px] font-bold text-purple-600 dark:text-purple-400">+{task.exp} XP</span>
                            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">+{task.points} Edu Coin</span>
                            {expires && (
                              <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                                <Clock size={11}/>
                                Sampai {expires.toLocaleString(language === 'en' ? 'en-US' : 'id-ID', { timeZone: 'Asia/Jakarta' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={task.completed || busyId !== null}
                        onClick={() => void claimTask(task.id)}
                        className={[
                          'flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition sm:w-auto',
                          task.completed
                            ? 'cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'
                            : 'bg-[#2563EB] text-white shadow-lg shadow-blue-600/25 hover:bg-[#3B82F6] disabled:cursor-not-allowed disabled:opacity-60',
                        ].join(' ')}
                      >
                        {isBusy ? <Loader2 size={14} className="animate-spin"/> : task.completed ? <Check size={14}/> : <Award size={14}/>}
                        {task.completed ? 'Selesai' : 'Selesaikan & Klaim'}
                      </button>
                    </div>
                  );
                })}
              </Card>
            </div>
          ) : (
            <ReferralProgramPanel />
          )}
        </div>

        {eventOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-black/70" onClick={() => setEventOpen(false)} aria-label="Tutup"/>
            <Card className="relative w-full max-w-sm border-slate-200 p-5 dark:border-[#1E293B]">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">{String(checkin?.event_name || 'Event Check-in')}</h3>
                <button type="button" onClick={() => setEventOpen(false)} aria-label="Tutup info event" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">×</button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {String(checkin?.event_description || text('Event khusus check-in.', 'Special check-in event.'))}
              </p>
              <button type="button" className="mt-4 w-full rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#3B82F6]" onClick={() => setEventOpen(false)}>Tutup</button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

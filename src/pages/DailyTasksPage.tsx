import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, Check, Clock, Flame, Award, Loader2, Sparkles, Info, Gift, ListChecks } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { claimAndCompleteDailyTask, getDailyTasks, type LiveDailyTask } from '@/services/daily-task.service';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/LanguageContext';
import { ReferralProgramPanel } from '@/components/referrals/ReferralProgramPanel';

export function DailyTasksPage() {
  const { toast, user } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'referral' ? 'referral' : 'tasks';
  const [displayedTab, setDisplayedTab] = useState<'tasks' | 'referral'>(activeTab);
  const [tabContentVisible, setTabContentVisible] = useState(true);
  const [referralReward, setReferralReward] = useState<number | null>(null);
  const [referralProgramActive, setReferralProgramActive] = useState(false);
  const { language } = useLanguage();
  const text = (id: string, en: string) => language === 'en' ? en : id;
  const [tasks, setTasks] = useState<LiveDailyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkin, setCheckin] = useState<any>(null);
  const [lastCheckin, setLastCheckin] = useState<{ checkin_date: string; streak_day: number } | null>(null);
  const [checked, setChecked] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

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

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [nextTasks, doneResult, rewardResult, latestCheckinResult] = await Promise.all([
        getDailyTasks(),
        supabase.from('daily_checkins').select('*').eq('user_id', user?.id ?? '').eq('checkin_date', todayKey).maybeSingle(),
        supabase.rpc('resolve_daily_checkin_reward', { p_date: todayKey, p_day_number: 1 }),
        supabase.from('daily_checkins').select('checkin_date, streak_day').eq('user_id', user?.id ?? '').order('checkin_date', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (doneResult.error) throw doneResult.error;
      if (rewardResult.error) throw rewardResult.error;
      if (latestCheckinResult.error) throw latestCheckinResult.error;
      setTasks(nextTasks);
      setChecked(Boolean(doneResult.data));
      setLastCheckin(latestCheckinResult.data ? {
        checkin_date: latestCheckinResult.data.checkin_date,
        streak_day: Number(latestCheckinResult.data.streak_day) || 0,
      } : null);
      setCheckin({ ...(rewardResult.data || {}), streak_day: doneResult.data?.streak_day || null });
    } catch (e: any) {
      setError(e?.message ?? text('Daily Tasks gagal dimuat.','Daily Tasks could not be loaded.'));
      setTasks([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const completedCount = useMemo(() => tasks.filter(t => t.completed).length, [tasks]);
  const currentStreak = useMemo(() => {
    if (!lastCheckin) return 0;
    const yesterdayKey = new Date(Date.parse(`${todayKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    if (lastCheckin.checkin_date !== todayKey && lastCheckin.checkin_date !== yesterdayKey) return 0;
    return Math.max(0, Number(lastCheckin.streak_day) || 0);
  }, [lastCheckin, todayKey]);
  const checkinProgress = tasks.length > 0 ? Math.round(completedCount / tasks.length * 100) : 0;
  const totalXp = useMemo(() => tasks.filter(t => t.completed).reduce((sum, t) => sum + t.exp, 0), [tasks]);

  const claimCheckin = async () => {
    setBusyId('checkin');
    try {
      const { data, error: rpcError } = await supabase.rpc('claim_daily_checkin', { p_date: todayKey });
      if (rpcError) throw rpcError;
      setChecked(true);
      const streak = Number(data?.streak_day || 1);
      const rewardType = data?.reward_type || 'XP';
      const reward = Number(data?.reward_amount || 0);
      const coin = Number(data?.coin_amount || 0);
      toast(text(`Check-in hari ke-${streak} berhasil. +${reward} ${rewardType}${coin > 0 ? ` dan +${coin} Coin` : ''}.`,`Daily check-in #${streak} claimed. +${reward} ${rewardType}${coin > 0 ? ` and +${coin} Coins` : ''}.`), 'success');
      await load();
    } catch (e: any) { toast(e?.message || 'Check-in gagal.', 'error'); }
    finally { setBusyId(null); }
  };

  const claimTask = async (taskId: string) => {
    setBusyId(taskId);
    try {
      const result: any = await claimAndCompleteDailyTask(taskId);
      toast(text(`Task selesai. +${Number(result?.exp ?? 0)} XP dan +${Number(result?.points ?? 0)} Edu Coin.`,`Task completed. +${Number(result?.exp ?? 0)} XP and +${Number(result?.points ?? 0)} Edu Coins.`), 'success');
      await load();
    } catch (e: any) { toast(e?.message ?? 'Task gagal diselesaikan.', 'error'); }
    finally { setBusyId(null); }
  };

  const eventActive = Boolean(checkin?.event_name);
  const borderClass = checkin?.frame_style === 'red-white'
    ? 'border-red-400/40'
    : checkin?.frame_style === 'gold-glow'
      ? 'border-amber-300/50 shadow-[0_0_24px_rgba(251,191,36,.12)]'
      : 'border-accent/35';

  return (
    <div>
      <div className="px-4 pt-4"><p className="text-xs text-fg-muted">{today}</p></div>
      <div className="p-4 pt-3 space-y-4">
        <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-[#151E32] p-2 shadow-xl sm:flex-row dark:border-slate-800">
          <div className="flex w-full items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1 sm:w-auto">
            <button id="tab-tasks-btn" type="button" onClick={() => switchTab('tasks')} aria-pressed={activeTab === 'tasks'} className={['flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs transition-all duration-300 sm:flex-initial sm:px-5', activeTab === 'tasks' ? 'bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-600/25 scale-[1.02]' : 'font-semibold text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'].join(' ')}>
              <ListChecks size={14}/>
              <span>Daily Tasks &amp; Check-in</span>
              <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{Math.max(0, tasks.length - completedCount)} Task Aktif</span>
            </button>
            <button id="tab-referral-btn" type="button" onClick={() => switchTab('referral')} aria-pressed={activeTab === 'referral'} className={['flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs transition-all duration-300 sm:flex-initial sm:px-5', activeTab === 'referral' ? 'bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-600/25 scale-[1.02]' : 'font-semibold text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'].join(' ')}>
              <Gift size={14} className={activeTab === 'referral' ? 'text-white transition-colors duration-300' : 'text-[#60A5FA] transition-colors duration-300'}/>
              <span>Program Referral</span>
              {referralProgramActive && referralReward !== null && <span className="ml-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">+{referralReward.toLocaleString('id-ID')} Edu Coin</span>}
            </button>
          </div>
          <div className="flex w-full items-center justify-center gap-3 px-3 sm:w-auto sm:justify-end">
            <span className="flex items-center gap-1.5 text-xs text-slate-300"><Flame size={13} className="text-amber-500"/> Streak: <strong className="text-white">{currentStreak} Hari</strong></span>
            <span className="h-3 w-px bg-slate-700"/>
            <span className="flex items-center gap-1.5 text-xs text-slate-300"><CalendarCheck size={13} className="text-[#60A5FA]"/> {checked ? 'Check-in Selesai' : 'Belum Check-in'}</span>
          </div>
        </div>
        <div className={['transition-all duration-300 ease-out', tabContentVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'].join(' ')}>
          {displayedTab === 'tasks' ? (
            <div className="space-y-4">
        <Card className={`relative overflow-hidden rounded-3xl border p-5 shadow-2xl sm:p-7 ${eventActive ? `${borderClass} ${checkin?.sparkle ? 'animate-pulse' : ''}` : 'border-amber-500/50 bg-gradient-to-r from-amber-950/40 via-slate-900 to-blue-950/60'}`}>
          <div className="pointer-events-none absolute -bottom-12 -left-10 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl"/>
          <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {checkin?.icon_url ? <img src={checkin.icon_url} alt="Ikon event" className="w-14 h-14 rounded-2xl object-contain surface-elevated shrink-0"/> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 shadow-lg shadow-amber-500/25"><CalendarCheck size={30}/></div>}
            <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="font-semibold text-fg">{text('Check-in Harian','Daily Check-in')}</p>{eventActive&&<Badge color="moss"><Sparkles size={10}/> {checkin.event_name}</Badge>}</div><p className="text-xs text-fg-muted mt-1">{checkin?.event_description || text(`Hadiah reguler: +${Number(checkin?.regular_xp || 50)} XP & +${Number(checkin?.regular_coin || 10)} Coin.`,`Regular reward: +${Number(checkin?.regular_xp || 50)} XP & +${Number(checkin?.regular_coin || 10)} Coins.`)}</p><div className="mt-2 flex gap-2 flex-wrap"><span className="text-xs text-accent font-semibold">+{Number(checkin?.reward_amount || checkin?.regular_xp || 50)} {checkin?.reward_type || 'XP'}</span>{Number(checkin?.coin_amount || 0)>0&&<span className="text-xs text-amber-300 font-semibold">+{Number(checkin.coin_amount)} Coin</span>}{checked&&<Badge color="moss"><Check size={10}/> Hari ke-{Number(checkin?.streak_day || 1)}</Badge>}</div></div>
            <div className="relative z-10 flex w-full shrink-0 items-center gap-2 sm:w-auto">{eventActive&&<button className="h-9 w-9 rounded-full border surface-border text-xs text-fg-muted" onClick={()=>setEventOpen(true)} aria-label="Info event"><Info size={14}/></button>}<Button className="min-w-36 sm:min-w-40" size="lg" disabled={checked||busyId!==null} loading={busyId==='checkin'} onClick={()=>void claimCheckin()}>{checked?text('Sudah Check-in','Checked in'):text('Check-in Hari Ini','Check in Today')}</Button></div>
          </div>
          {eventActive&&<button type="button" onClick={()=>setEventOpen(true)} className={`mt-3 w-full rounded-xl border p-2 text-left text-[11px] text-fg-muted ${borderClass}`}>{text('Tema event aktif · ketuk untuk melihat detail.','Active event theme · tap to view details.')}</button>}
        </Card>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="space-y-4 border-slate-800/80 p-5 dark:border-slate-800 lg:col-span-2" data-testid="daily-checkin-streak-tracker">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-amber-500"/>
                <h3 className="text-sm font-bold text-fg">{text('Aktivitas & Streak Check-in','Check-in Activity & Streak')}</h3>
              </div>
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-500">{text('Target Bonus: 7 Hari Streak','Bonus Target: 7-Day Streak')}</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5 pt-1 sm:gap-2">
              {Array.from({ length: 7 }, (_, index) => {
                const day = index + 1;
                const completed = day <= currentStreak;
                const ready = !checked && currentStreak < 7 && day === currentStreak + 1;
                const locked = !completed && !ready;
                return (
                  <div key={day} className={['space-y-1.5 rounded-xl border p-1.5 text-center sm:p-2.5', completed ? 'border-emerald-500/40 bg-emerald-500/5' : ready ? 'animate-pulse border-amber-500/60 bg-amber-500/10' : 'border-dashed border-slate-700/80 bg-slate-900/20 opacity-70'].join(' ')}>
                    <span className={['block text-[9px] font-semibold sm:text-[10px]', completed ? 'text-emerald-500' : ready ? 'text-amber-500' : 'text-slate-500'].join(' ')}>{text('Hari','Day')} {day}</span>
                    <div className={['mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold sm:h-7 sm:w-7', completed ? 'bg-emerald-500/20 text-emerald-500' : ready ? 'border border-amber-500/50 bg-slate-800 text-amber-400' : 'bg-slate-800 text-slate-500'].join(' ')}>
                      {completed ? <Check size={13}/> : day === 7 ? <Award size={12}/> : day}
                    </div>
                    <span className={['block text-[8px] font-medium leading-tight sm:text-[9px]', completed ? 'text-emerald-500' : ready ? 'text-amber-500' : 'text-slate-500'].join(' ')}>
                      {completed ? text('Selesai','Done') : ready ? text('Siap Klaim','Ready to claim') : locked ? text('Terkunci','Locked') : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-slate-800/70 pt-3 text-[10px] leading-relaxed text-fg-muted">{text('Status hari mengikuti check-in tersimpan. Hari berikutnya terbuka setelah check-in hari ini berhasil.','Day status follows saved check-in records. The next day opens after today’s check-in is claimed.')}</p>
          </Card>

          <Card className="flex flex-col justify-between space-y-4 border-slate-800/80 p-5 dark:border-slate-800">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-fg"><ListChecks size={16} className="text-[#3B82F6]"/> {text('Progres Tugas Hari Ini','Today’s Task Progress')}</h3>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 dark:bg-slate-900/80">
                  <p className="text-[10px] font-medium text-slate-500">{text('Task Selesai','Tasks Done')}</p>
                  <p className="mt-1 text-2xl font-black text-fg">{completedCount}<span className="ml-1 text-xs font-medium text-slate-500">/ {tasks.length}</span></p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 dark:bg-slate-900/80">
                  <p className="text-[10px] font-medium text-slate-500">{text('XP Diperoleh','XP Earned')}</p>
                  <p className="mt-1 text-2xl font-black text-purple-400">+{totalXp}</p>
                </div>
              </div>
            </div>
            <div className="space-y-1.5 border-t border-slate-800/70 pt-3">
              <div className="flex justify-between text-xs font-semibold"><span className="text-slate-500">{text('Kelengkapan Harian','Daily Completion')}</span><span className="text-[#3B82F6]">{checkinProgress}%</span></div>
              <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-900"><div className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-indigo-500 transition-all duration-300" style={{ width: `${checkinProgress}%` }}/></div>
            </div>
          </Card>
        </div>

        <Card className="border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-transparent p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15"><Flame size={24} className="text-amber-500"/></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{text('Aktivitas Harian','Daily Activity')}</p>
              <p className="text-xs text-fg-muted">{text('Streak check-in dan progres task mengikuti catatan backend.','Check-in streaks and task progress follow backend records.')}</p>
            </div>
            <div className="text-right"><p className="text-2xl font-bold text-fg">{completedCount}</p><p className="text-[10px] text-slate-500">{text('task selesai','tasks completed')}</p></div>
          </div>
        </Card>

        {loading && <Card className="p-8 text-center text-sm text-slate-500"><Loader2 size={18} className="animate-spin mx-auto mb-2"/>{text('Memuat data backend...','Loading backend data...')}</Card>}
        {error && !loading && <Card className="p-8 text-center text-red-300">{error}</Card>}
        {!loading && !error && tasks.length===0 && <Card className="p-8 text-center text-sm text-slate-500">{text('Belum ada Daily Task aktif di backend.','No active daily tasks are available yet.')}</Card>}

        {!loading && !error && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 pb-2 pt-1">
            <h3 className="flex items-center gap-2 text-sm font-bold text-fg"><ListChecks size={16} className="text-[#3B82F6]"/>{text('Daftar Daily Task Aktif','Active Daily Tasks')}</h3>
            <span className="text-[10px] text-fg-muted">{Math.max(0, tasks.length - completedCount)} {text('task tersisa','tasks remaining')}</span>
          </div>
        )}
        {!loading && !error && tasks.map((task) => {
          const expires = task.endsAt ? new Date(task.endsAt) : null;
          return (
            <Card key={task.id} className={`p-4 ${task.completed ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl surface-elevated flex items-center justify-center shrink-0"><CalendarCheck size={18} className="text-accent"/></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><h3 className="font-semibold text-sm text-fg">{task.title}</h3>{task.completed&&<Badge color="moss"><Check size={10}/> Selesai</Badge>}</div>
                  <p className="text-xs text-slate-400 mb-2">{task.description||text('Aktivitas harian SykaBelajar.','Daily SykaBelajar activity.')}</p>
                  <div className="flex items-center gap-3 flex-wrap"><span className="text-xs text-accent font-semibold">+{task.exp} XP</span><span className="text-xs text-amber-300 font-semibold">+{task.points} Coin</span>{expires&&<span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11}/> Sampai {expires.toLocaleString('id-ID')}</span>}</div>
                </div>
              </div>
              {!task.completed && <div className="mt-3 pl-[52px]"><Button size="sm" loading={busyId===task.id} disabled={busyId!==null} onClick={()=>void claimTask(task.id)} icon={<Award size={14}/>}>{text('Selesaikan & Klaim','Complete & Claim')}</Button></div>}
            </Card>
          );
        })}

        {eventOpen&&<div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"><button className="absolute inset-0" onClick={()=>setEventOpen(false)} aria-label="Tutup"/><Card className="relative w-full max-w-sm p-5"><div className="flex justify-between gap-3"><h3 className="font-semibold text-fg">{checkin?.event_name}</h3><button onClick={()=>setEventOpen(false)}>×</button></div><p className="text-sm text-fg-muted mt-3">{checkin?.event_description||text('Event khusus check-in.','Special check-in event.')}</p><Button className="mt-4" fullWidth onClick={()=>setEventOpen(false)}>Tutup</Button></Card></div>}
            </div>
          ) : (
            <ReferralProgramPanel />
          )}
        </div>
      </div>
    </div>
  );
}

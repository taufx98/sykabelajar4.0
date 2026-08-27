import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, Clock, Flame, Award, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { claimAndCompleteDailyTask, getDailyTasks, type LiveDailyTask } from '@/services/daily-task.service';

export function DailyTasksPage() {
  const { toast } = useApp();
  const [tasks, setTasks] = useState<LiveDailyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const load = async () => {
    setLoading(true); setError(null);
    try { setTasks(await getDailyTasks()); }
    catch (e: any) { setError(e?.message ?? 'Daily Tasks gagal dimuat.'); setTasks([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const completedCount = useMemo(() => tasks.filter(t => t.completed).length, [tasks]);
  const totalXp = useMemo(() => tasks.filter(t => t.completed).reduce((sum, t) => sum + t.exp, 0), [tasks]);

  const claim = async (taskId: string) => {
    setBusyId(taskId);
    try {
      const result: any = await claimAndCompleteDailyTask(taskId);
      toast(`Task selesai. +${Number(result?.exp ?? 0)} XP dan +${Number(result?.points ?? 0)} Edu Coin.`, 'success');
      await load();
    } catch (e: any) { toast(e?.message ?? 'Task gagal diselesaikan.', 'error'); }
    finally { setBusyId(null); }
  };

  return <div>
    <div className="sticky top-0 z-20 glass border-b border-white/5 px-4 py-3">
      <h2 className="font-display font-bold text-lg text-white">Daily Tasks</h2>
      <p className="text-xs text-slate-500">{today} · data live dari Supabase</p>
    </div>
    <div className="p-4 space-y-4">
      <Card className="p-4 bg-gradient-to-r from-amber-500/15 to-transparent border-amber-500/20">
        <div className="flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-amber-500/20 flex items-center justify-center"><Flame size={28} className="text-amber-400"/></div><div className="flex-1"><p className="text-sm font-semibold text-white">Aktivitas Harian</p><p className="text-xs text-slate-400">Streak hanya ditampilkan jika backend memiliki catatan aktivitas.</p></div><div className="text-right"><p className="text-2xl font-bold text-white">{completedCount}</p><p className="text-[10px] text-slate-500">selesai</p></div></div>
      </Card>
      <div className="grid grid-cols-2 gap-3"><Card className="p-4"><p className="text-xs text-slate-500 mb-1">Task Selesai</p><p className="text-2xl font-bold text-white">{completedCount}/{tasks.length}</p></Card><Card className="p-4"><p className="text-xs text-slate-500 mb-1">XP Hari Ini</p><p className="text-2xl font-bold gradient-text">+{totalXp}</p></Card></div>
      {loading && <Card className="p-8 text-center text-sm text-slate-500"><Loader2 size={18} className="animate-spin mx-auto mb-2"/>Memuat task dari backend...</Card>}
      {error && !loading && <Card className="p-8 text-center text-sm text-red-300">{error}</Card>}
      {!loading && !error && !tasks.length && <Card className="p-8 text-center text-sm text-slate-500">Belum ada Daily Task aktif di backend.</Card>}
      {!loading && !error && tasks.map(task => { const expires = task.endsAt ? new Date(task.endsAt) : null; return <Card key={task.id} className={`p-4 ${task.completed ? 'opacity-60' : ''}`}>
        <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-ink-800 flex items-center justify-center shrink-0"><CalendarCheck size={18} className="text-moss-400"/></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><h3 className="font-semibold text-sm text-white">{task.title}</h3>{task.completed&&<Badge color="moss"><Check size={10}/> Selesai</Badge>}</div><p className="text-xs text-slate-400 mb-2">{task.description || 'Aktivitas harian SykaBelajar.'}</p><div className="flex items-center gap-3 flex-wrap"><span className="text-xs text-moss-300 font-semibold">+{task.exp} XP</span><span className="text-xs text-amber-300 font-semibold">+{task.points} Coin</span>{expires&&<span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11}/> Sampai {expires.toLocaleString('id-ID')}</span>}</div></div></div>
        {!task.completed&&<div className="mt-3 pl-[52px]"><Button size="sm" loading={busyId===task.id} disabled={busyId!==null} onClick={()=>void claim(task.id)} icon={<Award size={14}/>}>Selesaikan & Klaim</Button></div>}
      </Card>; })}
    </div>
  </div>;
}

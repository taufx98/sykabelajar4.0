import { useEffect, useState } from 'react';
import { Award, RefreshCw, WandSparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export function AdminAwardsPage() {
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data: comps }, { data: current }] = await Promise.all([
      supabase.from('competitions').select('id,title,status,ends_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('awards').select('id,user_id,competition_id,rank_code,title,points,issued_at,visibility').order('issued_at', { ascending: false }).limit(100),
    ]);
    setCompetitions(comps ?? []);
    setAwards(current ?? []);
    if (!competitionId && comps?.[0]?.id) setCompetitionId(comps[0].id);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const generate = async () => {
    if (!competitionId) return;
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('generate_awards_for_competition', { p_competition_id: competitionId });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage(`${Number(data ?? 0)} award baru dibuat. Award yang sudah ada tidak digandakan.`);
    await load();
  };

  const visible = awards.filter((a) => !competitionId || a.competition_id === competitionId);
  return <div className="min-h-screen surface-bg p-5 md:p-8 text-fg-secondary">
    <div className="max-w-6xl mx-auto space-y-5">
      <div><p className="text-xs text-accent uppercase tracking-wider">Admin · Awards</p><h1 className="font-display text-2xl md:text-3xl font-bold text-fg">Generate Award & Sertifikat</h1><p className="text-sm text-slate-500 mt-1">Berbasis attempt FINALIZED dan reward lomba di Supabase.</p></div>
      <Card className="p-5">
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1 w-full"><label className="label">Lomba</label><select className="input" value={competitionId} onChange={e=>setCompetitionId(e.target.value)} disabled={loading}><option value="">Pilih lomba</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.title} · {c.status}</option>)}</select></div>
          <Button loading={busy} onClick={()=>void generate()} disabled={!competitionId} icon={<WandSparkles size={16}/>}>Generate Award</Button>
          <Button variant="outline" onClick={()=>void load()} icon={<RefreshCw size={15}/>}>Refresh</Button>
        </div>
        {message && <p className="text-sm mt-3 text-accent">{message}</p>}
      </Card>
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4"><Award size={18} className="text-accent"/><h2 className="font-semibold text-fg">Award yang sudah tersedia</h2></div>
        <div className="space-y-2">{visible.map(a=><div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[.03] border surface-border"><div className="flex-1"><p className="text-sm text-fg">{a.title}</p><p className="text-xs text-slate-500 font-mono">{a.user_id} · {a.rank_code}</p></div><Badge>{a.points} pts</Badge></div>)}{!visible.length&&!loading&&<p className="text-sm text-slate-500">Belum ada award untuk lomba ini.</p>}</div>
      </Card>
    </div>
  </div>;
}

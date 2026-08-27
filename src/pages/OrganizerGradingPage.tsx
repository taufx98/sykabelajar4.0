import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, Save } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { listOrganizerCompetitions } from '@/services/organizer.service';
import { getAttemptForGrading, listGradableAttempts, saveManualGrade, finalizeManualAttempt } from '@/services/manualGrading.service';

export function OrganizerGradingPage() {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true); setMessage('');
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sesi login tidak tersedia.');
      const { data: org, error } = await supabase.from('organizers').select('id').eq('owner_user_id', auth.user.id).maybeSingle();
      if (error) throw error;
      if (!org) throw new Error('Organisasi tidak ditemukan.');
      const competitions = await listOrganizerCompetitions(org.id);
      const rows = await listGradableAttempts(competitions.map((c: any) => c.id));
      setAttempts(rows);
      if (!selectedId && rows[0]?.id) setSelectedId(String(rows[0].id));
    } catch (e: any) { setMessage(e?.message ?? 'Gagal memuat attempt.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    void getAttemptForGrading(selectedId).then((value) => {
      if (!active) return;
      setDetail(value);
      const nextScores: Record<string, string> = {}; const nextFeedback: Record<string, string> = {};
      value.items.forEach((item: any) => { nextScores[item.id] = item.score == null ? '' : String(item.score); nextFeedback[item.id] = item.feedback ?? ''; });
      setScores(nextScores); setFeedback(nextFeedback);
    }).catch((e: any) => active && setMessage(e?.message ?? 'Gagal memuat grading.'));
    return () => { active = false; };
  }, [selectedId]);

  const total = useMemo(() => Object.values(scores).reduce((sum, value) => sum + (Number(value) || 0), 0), [scores]);

  const saveItem = async (item: any) => {
    const score = Number(scores[item.id]);
    if (!Number.isFinite(score) || score < 0 || score > Number(item.question?.points ?? 0)) {
      setMessage(`Nilai untuk soal ini harus 0 sampai ${Number(item.question?.points ?? 0)}.`); return;
    }
    setSaving(item.id);
    try { await saveManualGrade(item.id, score, feedback[item.id]); setMessage('Nilai dan feedback tersimpan.'); await reloadDetail(); }
    catch (e: any) { setMessage(e?.message ?? 'Gagal menyimpan nilai.'); }
    finally { setSaving(null); }
  };

  const reloadDetail = async () => { if (!selectedId) return; const value = await getAttemptForGrading(selectedId); setDetail(value); };
  const finalize = async () => {
    if (!detail || detail.items.some((item: any) => item.score == null && item.question?.type !== 'multiple-choice')) { setMessage('Selesaikan semua penilaian manual sebelum finalisasi.'); return; }
    setBusy(true);
    try { await finalizeManualAttempt(detail.attempt.id); setMessage('Attempt berhasil difinalisasi.'); await load(); }
    catch (e: any) { setMessage(e?.message ?? 'Gagal finalisasi.'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-ink-950 text-slate-200 p-5 md:p-8"><div className="max-w-6xl mx-auto space-y-5">
    <div><p className="text-xs text-moss-400 font-semibold">PENYELENGGARA · GRADING</p><h1 className="font-display text-2xl md:text-3xl font-bold text-white">Penilaian Manual</h1><p className="text-sm text-slate-500 mt-1">Nilai essay/file disimpan sebagai grading item di Supabase sebelum hasil difinalisasi.</p></div>
    {message && <Card className="p-3 text-sm text-amber-200 border-amber-500/20">{message}</Card>}
    <div className="grid lg:grid-cols-[320px_1fr] gap-5">
      <Card className="p-4"><div className="flex items-center gap-2 mb-3"><ClipboardCheck size={17} className="text-moss-400"/><h2 className="font-semibold text-white">Attempt</h2></div>{loading?<div className="py-8 text-center text-slate-500"><Loader2 className="animate-spin mx-auto mb-2"/>Memuat…</div>:attempts.length===0?<p className="text-sm text-slate-500">Belum ada attempt yang menunggu penilaian.</p>:<div className="space-y-2">{attempts.map((a)=><button key={a.id} onClick={()=>setSelectedId(a.id)} className={`w-full text-left p-3 rounded-xl border ${selectedId===a.id?'border-moss-500/40 bg-moss-500/10':'border-white/5 bg-white/[.02]'}`}><p className="text-sm text-white truncate">{a.id.slice(0,12)}</p><p className="text-xs text-slate-500">{a.status} · {a.attempt_number ? `Attempt ${a.attempt_number}`:''}</p></button>)}</div>}</Card>
      <Card className="p-5">{!detail?<div className="py-16 text-center text-slate-500">Pilih attempt untuk mulai menilai.</div>:<><div className="flex items-center justify-between gap-3 mb-5"><div><p className="text-sm text-white font-semibold">Attempt {detail.attempt.id.slice(0,12)}</p><p className="text-xs text-slate-500">{detail.items.length} item · skor sementara {total}</p></div><Button loading={busy} onClick={()=>void finalize()} icon={<CheckCircle2 size={15}/>}>Finalisasi</Button></div><div className="space-y-4">{detail.items.map((item:any,index:number)=><Card key={item.id} className="p-4 bg-white/[.02]"><div className="flex items-start gap-3"><div className="w-7 h-7 rounded-lg bg-moss-500/10 text-moss-300 flex items-center justify-center text-xs font-bold">{index+1}</div><div className="flex-1 min-w-0"><p className="text-sm text-white whitespace-pre-wrap">{item.question?.prompt || 'Soal'}</p><p className="text-xs text-slate-500 mt-1">{item.question?.type} · maksimal {item.question?.points ?? 0} poin</p><div className="mt-3 p-3 rounded-xl bg-ink-900 border border-white/5 text-sm text-slate-300 whitespace-pre-wrap break-words">{item.answer?.value ?? (item.answer ? JSON.stringify(item.answer) : 'Belum ada jawaban')}</div><div className="grid md:grid-cols-[160px_1fr_auto] gap-2 mt-3"><input className="input" type="number" min="0" max={Number(item.question?.points ?? 0)} step="0.1" placeholder="Nilai" value={scores[item.id] ?? ''} onChange={e=>setScores(s=>({...s,[item.id]:e.target.value}))}/><input className="input" placeholder="Feedback untuk peserta" value={feedback[item.id] ?? ''} onChange={e=>setFeedback(s=>({...s,[item.id]:e.target.value}))}/><Button size="sm" loading={saving===item.id} onClick={()=>void saveItem(item)} icon={<Save size={14}/>}>Simpan</Button></div></div></div></Card>)}</div></>}</Card>
    </div>
  </div></div>;
}

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, Send, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import {
  collectiveAccessToken,
  getCollectiveAttemptAnswers,
  getCollectiveParticipantQuestions,
  startCollectiveCompetitionAttempt,
  saveCollectiveAttemptAnswer,
  submitCollectiveCompetitionAttempt,
  type CollectiveAttempt,
  type CollectiveQuestion,
} from '@/services/collectiveParticipant.service';

const readParticipant = () => { try { return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null; } catch { return null; } };

export function CollectiveParticipantWorkPage() {
  const navigate = useNavigate();
  const participant = useMemo(readParticipant, []);
  const competitionId = String(participant?.competition_id || '');
  const [questions, setQuestions] = useState<CollectiveQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<CollectiveAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!participant || !collectiveAccessToken() || !competitionId) { navigate('/peserta-kolektif/login', { replace: true }); return; }
    let active = true;
    (async () => {
      try {
        const [q, a] = await Promise.all([getCollectiveParticipantQuestions(competitionId), startCollectiveCompetitionAttempt(competitionId)]);
        const existing = await getCollectiveAttemptAnswers(a.id);
        if (!active) return;
        setQuestions(q); setAttempt(a); setAnswers({ ...existing });
      } catch (e: any) {
        toast.error(e?.message || 'Gagal membuka lomba.');
        const message = String(e?.message || '');
        if (message.includes('COLLECTIVE_SESSION_INVALID')) { sessionStorage.removeItem('syka_collective_access_token'); sessionStorage.removeItem('syka_collective_participant'); navigate('/peserta-kolektif/login', { replace: true }); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [competitionId, navigate, participant]);

  useEffect(() => {
    if (!attempt?.expires_at) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((new Date(attempt.expires_at as string).getTime() - Date.now()) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [attempt?.expires_at]);

  const updateAnswer = async (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setSaving(questionId);
    try { await saveCollectiveAttemptAnswer(String(attempt?.id || ''), questionId, value); }
    catch (e: any) { toast.error(e?.message || 'Jawaban gagal disimpan.'); }
    finally { setSaving(null); }
  };

  const submit = async () => {
    if (!attempt) return;
    if (!window.confirm('Kirim jawaban sekarang? Setelah dikirim, jawaban tidak dapat dilanjutkan.')) return;
    setSubmitting(true);
    try { await submitCollectiveCompetitionAttempt(attempt.id); navigate('/peserta-kolektif', { replace: true }); }
    catch (e: any) { toast.error(e?.message || 'Gagal mengirim jawaban.'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="min-h-screen surface-bg flex items-center justify-center text-fg-muted">Memuat ruang lomba…</div>;
  if (!participant || !attempt) return <div className="min-h-screen surface-bg p-5"><Card className="max-w-xl mx-auto p-8 text-center"><p className="text-fg font-semibold">Sesi lomba tidak tersedia.</p><Button className="mt-4" onClick={() => navigate('/peserta-kolektif')}>Kembali</Button></Card></div>;

  const minutes = Math.floor((secondsLeft ?? 0) / 60); const seconds = (secondsLeft ?? 0) % 60;
  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-4xl mx-auto space-y-5">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><button className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg" onClick={()=>navigate('/peserta-kolektif')}><ArrowLeft size={14}/> Portal</button><p className="text-xs text-accent font-semibold tracking-wider mt-4">RUANG LOMBA</p><h1 className="text-2xl font-bold text-fg">{String(participant.competition_title || 'Kompetisi')}</h1><p className="text-sm text-fg-muted">Peserta: {String(participant.full_name || 'Peserta')}</p></div><Badge color="moss"><ShieldCheck size={13}/> Akses aman</Badge></div>
    <Card className="p-4 sticky top-3 z-10"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-fg-muted">Progress</p><p className="text-sm text-fg font-semibold">{Object.values(answers).filter(Boolean).length} / {questions.length} terjawab</p></div><div className={`flex items-center gap-2 font-mono text-lg font-bold ${secondsLeft !== null && secondsLeft < 300 ? 'text-red-400' : 'text-fg'}`}><Clock3 size={18}/>{minutes.toString().padStart(2,'0')}:{seconds.toString().padStart(2,'0')}</div></div></Card>
    <div className="space-y-4">{questions.map((q,index)=><Card key={q.id} className="p-5"><div className="flex items-start gap-3"><div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center text-xs font-bold shrink-0">{index+1}</div><div className="flex-1"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-fg whitespace-pre-wrap">{q.prompt}</p><span className="text-xs text-fg-muted shrink-0">{q.points} poin</span></div><div className="mt-4">{q.type === 'multiple_choice' || q.type === 'true_false' ? <div className="space-y-2">{q.options.map((opt)=><label key={opt.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 cursor-pointer ${answers[q.id]===opt.id?'border-accent bg-accent/5':'border-border'}`}><input type="radio" name={q.id} checked={answers[q.id]===opt.id} onChange={()=>void updateAnswer(q.id,opt.id)}/><span className="text-sm text-fg-secondary">{opt.label}</span></label>)}</div> : <textarea className="w-full min-h-32 rounded-xl border border-border bg-transparent px-3 py-3 text-sm" value={answers[q.id]||''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))} onBlur={e=>void updateAnswer(q.id,e.target.value)} placeholder="Tulis jawaban…" disabled={secondsLeft===0}/>}<p className="text-[11px] text-fg-muted mt-2">{saving===q.id?'Menyimpan…':'Jawaban tersimpan otomatis saat pilihan dipilih atau saat kolom jawaban selesai diisi.'}</p></div></div></div></Card>)}</div>
    <Card className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="font-semibold text-fg">Sudah selesai?</p><p className="text-xs text-fg-muted mt-1">Pastikan semua jawaban yang diperlukan sudah terisi.</p></div><Button onClick={()=>void submit()} loading={submitting} disabled={secondsLeft===0} icon={<Send size={15}/>}>Kirim jawaban</Button></Card>
  </div></div>;
}

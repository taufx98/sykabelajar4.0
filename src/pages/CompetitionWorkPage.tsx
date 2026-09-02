import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Check, AlertCircle, Upload, Send, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug } from '@/services/competition.service';
import { getParticipantQuestions, getAttemptAnswers, saveAnswer, startAttempt, submitAttempt, type Attempt, type ParticipantQuestion } from '@/services/assessment.service';
import { uploadRawFile } from '@/services/cloudinary.service';
import { fireConfetti } from '@/components/ui/Confetti';

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export function CompetitionWorkPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { toast, addNotification, isAuthenticated } = useApp();
  const [competition, setCompetition] = useState<any>(null);
  const [questions, setQuestions] = useState<ParticipantQuestion[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!slug || !isAuthenticated) { setLoading(false); return; }
      try {
        setLoading(true);
        const c = await getCompetitionBySlug(slug);
        if (!c) throw new Error('Lomba tidak ditemukan.');
        const [qs, currentAttempt] = await Promise.all([getParticipantQuestions(c.id), startAttempt(c.id)]);
        const saved = await getAttemptAnswers(currentAttempt.id);
        if (!alive) return;
        setCompetition(c); setQuestions(qs); setAttempt(currentAttempt); setAnswers(saved);
        setSubmitted(['SUBMITTED', 'GRADING', 'FINALIZED', 'EXPIRED'].includes(currentAttempt.status));
      } catch (e: any) { if (alive) setError(e?.message ?? 'Gagal memuat ujian.'); }
      finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; Object.values(saveTimers.current).forEach(window.clearTimeout); };
  }, [slug, isAuthenticated]);

  const timeLeft = useMemo(() => !attempt?.expires_at ? 0 : Math.max(0, Math.floor((new Date(attempt.expires_at).getTime() - Date.now()) / 1000)), [attempt]);
  const [clock, setClock] = useState(0);
  useEffect(() => { setClock(timeLeft); }, [timeLeft]);
  useEffect(() => {
    if (!attempt || submitted || !attempt.expires_at) return;
    const timer = window.setInterval(() => setClock(Math.max(0, Math.floor((new Date(attempt.expires_at as string).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [attempt, submitted]);

  const currentAttempt = attempt;

  const setAnswer = (qid: string, value: string) => {
    if (!currentAttempt) return;
    setAnswers((current) => ({ ...current, [qid]: value }));
    window.clearTimeout(saveTimers.current[qid]);
    saveTimers.current[qid] = window.setTimeout(() => {
      void saveAnswer(currentAttempt.id, qid, value)
        .then(() => setSavedFlash(true))
        .catch((e: any) => toast(e?.message ?? 'Jawaban gagal disimpan.', 'error'));
      window.setTimeout(() => setSavedFlash(false), 1200);
    }, 500);
  };

  const uploadAnswerFile = async (qid: string, file: File) => {
    if (!currentAttempt) return;
    setUploading(qid);
    try {
      const result = await uploadRawFile(file, `sykabelajar/answers/${currentAttempt.id}`);
      const serialized = JSON.stringify({ type: 'file', url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type ?? 'raw', file_name: file.name });
      setAnswers((current) => ({ ...current, [qid]: serialized }));
      await saveAnswer(currentAttempt.id, qid, serialized);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
      toast('File jawaban berhasil disimpan.', 'success');
    } catch (e: any) { toast(e?.message ?? 'File gagal diupload.', 'error'); }
    finally { setUploading(null); }
  };

  const answeredCount = Object.values(answers).filter(Boolean).length;
  const requiredLeft = questions.filter((q) => q.required && !answers[q.id]).length;

  async function handleSubmit(auto = false) {
    if (!currentAttempt || !submitting === false || submitted) return;
    if (!auto && requiredLeft > 0) { toast(`Masih ada ${requiredLeft} soal wajib belum dijawab`, 'error'); return; }
    if (Object.values(saveTimers.current).some(Boolean)) await new Promise((resolve) => window.setTimeout(resolve, 550));
    setSubmitting(true);
    try {
      const result = await submitAttempt(currentAttempt.id);
      setAttempt(result); setSubmitted(true); fireConfetti();
      toast(auto ? 'Waktu habis. Jawaban yang tersimpan telah dikirim.' : 'Jawaban berhasil dikirim!', 'success');
      if (competition) {
        try { await addNotification({ type: 'result-out', title: 'Jawaban Diterima', body: `Jawabanmu untuk ${competition.title} telah tersimpan di sistem dan menunggu penilaian.`, link: `/lomba/${competition.slug}`, icon: 'check' }); } catch (nErr) { console.warn('[SykaBelajar] notification after submit failed', nErr); }
      }
    } catch (e: any) { toast(e?.message ?? 'Gagal mengirim jawaban.', 'error'); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    if (clock === 0 && !submitted && !submitting && currentAttempt?.expires_at && new Date(currentAttempt.expires_at).getTime() <= Date.now()) {
      void handleSubmit(true);
    }
  }, [clock, submitted, submitting, currentAttempt?.expires_at]);

  if (!isAuthenticated) return <div className="p-8 text-center text-slate-400">Silakan login terlebih dahulu untuk mengerjakan lomba.</div>;
  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-slate-400"><Loader2 className="animate-spin mr-2" size={20} /> Memuat ujian...</div>;
  if (error) return <div className="p-8 text-center"><p className="text-red-300 mb-4">{error}</p><Link to="/home"><Button variant="ghost">Kembali</Button></Link></div>;
  if (!competition || !attempt) return <div className="p-8 text-center text-slate-400">Data ujian tidak tersedia.</div>;

  return <div className="min-h-screen"><div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3 flex items-center gap-3"><button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/5 dark:hover:bg-white/5"><ArrowLeft size={20} className="text-fg-secondary" /></button><div className="flex-1 min-w-0"><h2 className="font-display font-semibold text-sm text-white truncate">{competition.title}</h2><p className="text-xs text-slate-500">{answeredCount}/{questions.length} terjawab</p></div><div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-sm font-semibold ${clock < 300 ? 'bg-err/15 text-red-300' : 'bg-moss-500/15 text-accent'}`}><Clock size={14} /> {formatTime(clock)}</div></div>{savedFlash&&<div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 chip bg-moss-500/20 text-accent border border-moss-500/30 animate-slide-down"><Check size={12}/> Jawaban tersimpan</div>}<div className="max-w-2xl mx-auto p-4 space-y-4 pb-24"><Card className="p-4 bg-sky-500/5 border-sky-500/20"><div className="flex items-start gap-2"><AlertCircle size={16} className="text-sky-400 mt-0.5 shrink-0"/><p className="text-xs text-fg-secondary">Jawaban disimpan otomatis ke server setelah berhenti mengetik. Timer mengikuti waktu server.</p></div></Card>{questions.length === 0 ? <Card className="p-8 text-center"><p className="text-slate-400">Lomba ini belum memiliki soal online yang dipublikasikan.</p><Link to={`/lomba/${competition.slug}`}><Button variant="ghost" className="mt-4">Kembali</Button></Link></Card> : submitted ? <Card className="p-8 text-center animate-scale-in"><div className="w-16 h-16 rounded-full bg-moss-500/20 flex items-center justify-center mx-auto mb-4"><Check size={32} className="text-accent" /></div><h2 className="font-display font-bold text-xl text-white mb-2">Jawaban Terkirim!</h2><p className="text-sm text-slate-400 mb-4">Status: <Badge color="warn">Menunggu Penilaian</Badge></p><p className="text-sm text-slate-400 mb-6">Jawaban tersimpan di server. Hasil akan diumumkan setelah proses penilaian selesai.</p><div className="flex gap-2"><Link to="/home" className="flex-1"><Button variant="outline" fullWidth>Beranda</Button></Link><Link to={`/lomba/${competition.slug}`} className="flex-1"><Button fullWidth>Detail Lomba</Button></Link></div></Card> : <>{questions.map((q,i)=><QuestionCard key={q.id} question={q} index={i} answer={answers[q.id]??''} uploading={uploading===q.id} onChange={(value)=>setAnswer(q.id,value)} onFile={(file)=>void uploadAnswerFile(q.id,file)}/>)}<div className="sticky bottom-4"><Card className="p-4 flex items-center gap-3"><div className="flex-1"><p className="text-sm text-fg font-medium">{answeredCount}/{questions.length} dijawab</p><p className="text-xs text-slate-400">{requiredLeft?`${requiredLeft} soal wajib belum dijawab`:'Semua soal wajib terjawab'}</p></div><Button loading={submitting} onClick={()=>void handleSubmit(false)} icon={<Send size={16}/>}>Submit Jawaban</Button></Card></div></>}</div></div>;
}

function QuestionCard({question,index,answer,onChange,onFile,uploading}:{question:ParticipantQuestion;index:number;answer:string;onChange:(v:string)=>void;onFile:(file:File)=>void;uploading:boolean}){
  let fileMeta:any=null;
  if(question.type==='file-upload'&&answer){try{fileMeta=JSON.parse(answer)}catch{}}
  return <Card className="p-4 animate-fade-in"><div className="flex items-start gap-3 mb-3"><div className="w-7 h-7 rounded-lg bg-moss-500/15 flex items-center justify-center text-xs font-bold text-accent shrink-0">{index+1}</div><div className="flex-1"><p className="text-sm text-fg font-medium leading-relaxed">{question.prompt}</p><div className="flex items-center gap-2 mt-1.5"><Badge>{question.points} poin</Badge>{question.required&&<Badge color="warn">Wajib</Badge>}</div></div></div>{question.type==='multiple-choice'&&question.options&&<div className="space-y-2 pl-10">{question.options.map((opt)=><button key={opt.id} onClick={()=>onChange(opt.id)} className={`w-full text-left px-3.5 py-2.5 rounded-xl border-2 transition flex items-center gap-3 ${answer===opt.id?'border-moss-500 bg-moss-500/10':'surface-border hover:surface-border'}`}><div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${answer===opt.id?'border-moss-500':'border-slate-600'}`}>{answer===opt.id&&<div className="w-2.5 h-2.5 rounded-full bg-moss-500"/>}</div><span className={`text-sm ${answer===opt.id?'text-moss-200':'text-fg-secondary'}`}>{opt.label}</span></button>)}</div>}{question.type==='short-answer'&&<div className="pl-10"><input className="input" placeholder="Tulis jawaban singkat..." value={answer} onChange={(e)=>onChange(e.target.value)}/></div>}{question.type==='essay'&&<div className="pl-10"><textarea className="input min-h-[120px] resize-y" placeholder="Tulis esaimu di sini..." value={answer} onChange={(e)=>onChange(e.target.value)}/></div>}{question.type==='file-upload'&&<div className="pl-10"><label className={`w-full border-2 border-dashed ${fileMeta?'border-moss-500/40':'surface-border'} rounded-xl py-8 flex flex-col items-center gap-2 cursor-pointer hover:bg-white/5 dark:hover:bg-white/5 transition`}><input type="file" className="hidden" disabled={uploading} onChange={(e)=>{const f=e.target.files?.[0];if(f)onFile(f);e.currentTarget.value='';}}/><FileText size={24} className={fileMeta?'text-accent':'text-slate-500'}/><span className="text-sm text-fg-secondary">{uploading?'Mengunggah...':fileMeta?.file_name||'Pilih file jawaban'}</span><span className="text-xs text-slate-600">Maksimal 10MB</span></label></div>}</Card>;
}

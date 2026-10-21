import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck, SkipForward, TimerReset, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import { collectiveAccessToken } from '@/services/collectiveParticipant.service';
import { uploadRawFile } from '@/services/cloudinary.service';
import {
  answerAndAdvanceSecureExam, getSecureExamState, resolveSecureExamTimeout,
  saveSecureExamAnswer, skipSecureExamQuestion, startSecureExamAttempt,
  type SecureExamState,
} from '@/services/secureExam.service';

const readParticipant = () => {
  try { return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null; }
  catch { return null; }
};
function formatSeconds(total: number) {
  const s = Math.max(0, total);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}
function deadlineFor(state: SecureExamState | null) {
  if (!state) return null;
  if (state.phase === 'TIMEOUT_DECISION') return state.decision_deadline;
  if (state.phase === 'OVERTIME') return state.overtime_deadline;
  if (state.phase === 'ACTIVE') return state.current_deadline;
  return null;
}

export function CollectiveParticipantWorkPage() {
  const navigate = useNavigate();
  const participant = useMemo(readParticipant, []);
  const competitionId = String(participant?.competition_id || '');
  const accessToken = collectiveAccessToken();
  const [exam, setExam] = useState<SecureExamState | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);
  const answerLock = useRef(false);

  const acceptState = useCallback((next: SecureExamState, restoreDraft = true) => {
    setExam(next);
    setServerOffset(Date.parse(next.server_now) - Date.now());
    setNow(Date.now());
    if (restoreDraft) {
      setDraft(next.question?.answer && typeof next.question.answer === 'object'
        ? { ...next.question.answer }
        : {});
    }
    answerLock.current = false;
  }, []);

  const refresh = useCallback(async () => {
    if (!exam) return;
    acceptState(await getSecureExamState(exam.attempt_id, competitionId, accessToken));
  }, [exam?.attempt_id, competitionId, accessToken, acceptState]);

  useEffect(() => {
    if (!participant || !accessToken || !competitionId) {
      navigate('/peserta-kolektif/login', { replace: true });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const state = await startSecureExamAttempt(competitionId, accessToken);
        if (alive) acceptState(state);
      } catch (e: any) {
        const message = String(e?.message || 'Gagal membuka ruang ujian.');
        if (alive) setError(message);
        if (message.includes('COLLECTIVE_SESSION_INVALID')) {
          sessionStorage.removeItem('syka_collective_access_token');
          sessionStorage.removeItem('syka_collective_participant');
          navigate('/peserta-kolektif/login', { replace: true });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [competitionId, accessToken, navigate, participant, acceptState]);

  useEffect(() => {
    if (!exam || exam.phase === 'FINISHED') return;
    let lastSync = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const deadline = deadlineFor(exam);
      const remaining = deadline ? Math.floor((Date.parse(deadline) - (current + serverOffset)) / 1000) : null;
      if (remaining !== null && remaining <= 0 && current - lastSync > 900) {
        lastSync = current;
        void getSecureExamState(exam.attempt_id, competitionId, accessToken).then(acceptState).catch((e: any) => {
          toast.error(e?.message || 'Timer belum dapat disinkronkan dengan server.');
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void getSecureExamState(exam.attempt_id, competitionId, accessToken).then(acceptState).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [exam?.attempt_id, exam?.phase, exam?.current_deadline, exam?.decision_deadline, exam?.overtime_deadline, exam?.exam_deadline, competitionId, accessToken, serverOffset, acceptState]);

  useEffect(() => {
    if (!exam?.question || !['ACTIVE', 'OVERTIME'].includes(exam.phase)) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        const next = await saveSecureExamAnswer(exam.attempt_id, competitionId, draft, accessToken);
        acceptState(next, false);
      } catch (e: any) {
        toast.error(e?.message || 'Jawaban belum tersimpan. Coba lagi sebelum berpindah soal.');
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft, exam?.attempt_id, exam?.position, exam?.phase, competitionId, accessToken, acceptState]);

  const remaining = useMemo(() => {
    const deadline = deadlineFor(exam);
    return deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - (now + serverOffset)) / 1000)) : 0;
  }, [exam?.phase, exam?.current_deadline, exam?.decision_deadline, exam?.overtime_deadline, now, serverOffset]);

  const runAction = async (action: () => Promise<SecureExamState>, message?: string) => {
    if (busy) return;
    setBusy(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    try {
      const next = await action();
      acceptState(next);
      if (message) toast.success(message);
    } catch (e: any) {
      toast.error(e?.message || 'Aksi gagal diproses server.');
      try { await refresh(); } catch { /* keep last confirmed state */ }
    } finally {
      setBusy(false);
    }
  };

  const submitCurrent = async () => {
    if (!exam || busy || answerLock.current) return;
    answerLock.current = true;
    await runAction(() => answerAndAdvanceSecureExam(exam.attempt_id, competitionId, draft, accessToken),
      exam.position >= exam.total_questions ? 'Jawaban dikirim ke server.' : 'Jawaban diterima. Beralih ke soal selanjutnya.');
  };
  const skipCurrent = () => {
    if (!exam) return;
    void runAction(() => skipSecureExamQuestion(exam.attempt_id, competitionId, accessToken), 'Soal dilewati dan dicatat.');
  };
  const resolveTimeout = (action: 'borrow' | 'grace' | 'skip') => {
    if (!exam) return;
    void runAction(() => resolveSecureExamTimeout(exam.attempt_id, competitionId, action, accessToken),
      action === 'borrow' ? '30 detik dipinjam dari soal berikutnya.' : action === 'grace' ? 'Waktu tambahan digunakan.' : 'Soal dilewati.');
  };
  const uploadAnswerFile = async (file: File) => {
    if (!exam) return;
    setUploading(true);
    try {
      const result = await uploadRawFile(file, 'sykabelajar/answers/' + exam.attempt_id);
      const answer = { type: 'file', url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type ?? 'raw', file_name: file.name };
      setDraft(answer);
      acceptState(await saveSecureExamAnswer(exam.attempt_id, competitionId, answer, accessToken), false);
      toast.success('Berkas jawaban tersimpan.');
    } catch (e: any) {
      toast.error(e?.message || 'Berkas jawaban gagal disimpan.');
    } finally { setUploading(false); }
  };

  if (loading) return <div className="min-h-screen surface-bg flex items-center justify-center text-fg-muted"><Loader2 className="animate-spin mr-2" size={20}/> Menyiapkan ruang ujian aman…</div>;
  if (error && !exam) return <div className="min-h-screen surface-bg p-5 flex items-center justify-center"><Card className="max-w-lg p-7 text-center"><AlertTriangle className="mx-auto text-amber-400 mb-3" size={26}/><p className="text-fg">{error}</p><Button className="mt-4" onClick={() => navigate('/peserta-kolektif/login')}>Kembali ke login</Button></Card></div>;
  if (!participant || !exam) return <div className="min-h-screen surface-bg p-5"><Card className="max-w-lg mx-auto p-7 text-center">Sesi ujian tidak tersedia.</Card></div>;

  const q = exam.question;
  const currentValue = typeof draft.value === 'string' ? draft.value : '';
  const borrowAvailable = exam.position < exam.total_questions && exam.base_seconds + exam.time_bank_seconds >= 60;
  const canEdit = Boolean(q) && ['ACTIVE', 'OVERTIME'].includes(exam.phase) && remaining > 0 && !busy;

  return <div className="min-h-screen surface-bg text-fg-secondary pb-8">
    <header className="sticky top-0 z-20 border-b surface-border surface-card-bg/95 backdrop-blur px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><ShieldCheck size={20}/></div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-fg truncate">{String(participant.competition_title || 'Lomba')}</h1>
          <p className="text-xs text-fg-muted">Peserta: {String(participant.full_name || 'Peserta')} · Ujian berurutan</p>
        </div>
        {exam.phase !== 'FINISHED' && <div className={'flex items-center gap-2 font-mono font-bold text-lg ' + (remaining <= 10 ? 'text-red-400' : 'text-fg')}><Clock3 size={17}/>{formatSeconds(remaining)}</div>}
      </div>
    </header>

    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs text-fg-muted">Progress</p><p className="font-semibold text-fg">{exam.phase === 'FINISHED' ? exam.total_questions : exam.position} / {exam.total_questions} soal</p></div>
          <div className="flex items-center gap-2">{saving ? <Badge color="warn">Menyimpan…</Badge> : <Badge color="moss"><Wifi size={12}/> Sinkron</Badge>}{exam.phase === 'OVERTIME' && <Badge color="warn"><TimerReset size={12}/> Tambahan</Badge>}</div>
        </div>
        <div className="h-2 rounded-full bg-white/10 mt-3 overflow-hidden"><div className="h-full bg-accent" style={{width: Math.min(100, (exam.position / exam.total_questions) * 100) + '%'}}/></div>
      </Card>

      {exam.phase === 'FINISHED' ? <Card className="p-8 text-center">
        <CheckCircle2 className="mx-auto text-emerald-400 mb-4" size={36}/>
        <h2 className="text-xl font-bold text-fg">Ujian selesai</h2>
        <p className="text-sm text-fg-muted mt-2">Jawaban dan status soal sudah diproses oleh server. Nilai, kunci jawaban, dan peringkat tidak ditampilkan sebelum pengumuman resmi.</p>
        <Button className="mt-5" onClick={() => navigate('/peserta-kolektif', {replace:true})}>Kembali ke portal peserta</Button>
      </Card> : exam.phase === 'TIMEOUT_DECISION' ? <Card className="p-6 border-amber-500/40">
        <div className="flex items-start gap-3"><AlertTriangle className="text-amber-300 mt-1" size={24}/><div className="flex-1">
          <p className="text-xs uppercase tracking-wide font-semibold text-amber-300">Waktu soal habis</p>
          <h2 className="text-xl font-bold text-fg mt-1">Pilih cara melanjutkan</h2>
          <p className="text-sm text-fg-muted mt-2">Waktu keputusan {formatSeconds(remaining)}. Jika tidak memilih, server akan memberikan tambahan waktu yang masih tersedia selama 30 detik; jika tidak ada, soal otomatis dilewati.</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <Button loading={busy} disabled={!borrowAvailable || busy} onClick={() => resolveTimeout('borrow')}>Pinjam 30 detik dari soal berikutnya</Button>
            <Button variant="outline" loading={busy} disabled={exam.grace_remaining_seconds <= 0 || busy} onClick={() => resolveTimeout('grace')}>Gunakan waktu tambahan</Button>
            <Button variant="ghost" disabled={busy} onClick={() => resolveTimeout('skip')} icon={<SkipForward size={16}/>}>Lewati soal</Button>
          </div>
          {!borrowAvailable && <p className="text-xs text-fg-muted mt-3">Pinjaman tidak tersedia: waktu minimum soal berikutnya harus tetap tersedia.</p>}
        </div></div>
      </Card> : q ? <Card className="p-5 md:p-7">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent font-bold flex items-center justify-center shrink-0">{exam.position}</div>
          <div className="flex-1"><div className="flex flex-wrap gap-2 mb-3"><Badge>Soal {exam.position}</Badge><Badge>{q.points} poin</Badge>{exam.phase === 'OVERTIME' && <Badge color="warn">Waktu tambahan</Badge>}</div><div className="text-base md:text-lg font-semibold leading-relaxed text-fg whitespace-pre-wrap">{q.prompt}</div>
            {typeof q.config?.image_url === 'string' && <img className="mt-4 max-h-80 rounded-xl object-contain" src={String(q.config.image_url)} alt="Ilustrasi soal"/>}
            {typeof q.config?.media_url === 'string' && <a className="text-sm text-accent underline inline-block mt-3" href={String(q.config.media_url)} target="_blank" rel="noreferrer">Buka media soal</a>}
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options.map(option => <button key={option.id} type="button" disabled={!canEdit} onClick={() => setDraft({value:option.id})} className={'w-full rounded-xl border p-4 text-left flex items-center gap-3 ' + (currentValue===option.id?'border-accent bg-accent/10':'border-border') + (!canEdit?' opacity-70':'')}>
            <span className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 '+(currentValue===option.id?'border-accent':'border-fg-muted')}>{currentValue===option.id&&<span className="w-2.5 h-2.5 rounded-full bg-accent"/>}</span><span className="text-sm whitespace-pre-wrap">{option.label}</span>
          </button>)}
          {(q.type === 'short_answer' || q.type === 'numeric') && <input className="input" type={q.type==='numeric'?'number':'text'} value={currentValue} disabled={!canEdit} onChange={e=>setDraft({value:e.target.value})} placeholder="Tulis jawaban…"/>}
          {q.type === 'multiple_checkbox' && q.options.map(option=>{const selected=Array.isArray(draft.values)?draft.values.map(String):[];return <label key={option.id} className={'flex items-center gap-3 rounded-xl border p-4 '+(selected.includes(option.id)?'border-accent bg-accent/10':'border-border')+(!canEdit?' opacity-70':' cursor-pointer')}><input type="checkbox" disabled={!canEdit} checked={selected.includes(option.id)} onChange={()=>setDraft({values:selected.includes(option.id)?selected.filter(id=>id!==option.id):[...selected,option.id]})}/><span className="text-sm">{option.label}</span></label>;})}
          {(q.type === 'essay' || q.type === 'long_answer') && <textarea className="input min-h-40 resize-y" value={currentValue} disabled={!canEdit} onChange={e=>setDraft({value:e.target.value})} placeholder="Tuliskan jawaban…"/>}
          {(q.type === 'file_upload' || q.type === 'file-upload') && <label className="border border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer"><FileText size={25} className="text-accent"/><span className="text-sm text-fg">{String(draft.file_name||'Pilih berkas jawaban')}</span><input className="hidden" type="file" disabled={!canEdit||uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadAnswerFile(file);e.currentTarget.value='';}}/>{uploading&&<span className="text-xs text-fg-muted">Mengunggah…</span>}</label>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-7 pt-5 border-t border-border">
          <p className="text-xs text-fg-muted">{saving?'Menyimpan ke server…':'Soal terdahulu terkunci. Jawaban yang melewati batas waktu tidak dapat diubah.'}</p>
          <div className="flex gap-2 justify-end"><Button variant="ghost" disabled={busy||!canEdit} onClick={skipCurrent} icon={<SkipForward size={16}/>}>Lewati</Button><Button loading={busy} disabled={!canEdit||busy} onClick={() => void submitCurrent()} icon={<ArrowRight size={16}/>}>Jawab & lanjut</Button></div>
        </div>
      </Card> : <Card className="p-7 text-center"><Loader2 className="animate-spin mx-auto mb-3" size={24}/><p className="text-sm">Menyinkronkan status ujian dengan server…</p></Card>}

      <p className="text-center text-xs text-fg-muted">Sesi ujian kolektif diverifikasi dengan token backend. Timer lokal hanya tampilan.</p>
    </main>
  </div>;
}

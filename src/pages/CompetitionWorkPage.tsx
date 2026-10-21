import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck, SkipForward, ArrowRight, Wifi, TimerReset } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug } from '@/services/competition.service';
import { uploadRawFile } from '@/services/cloudinary.service';
import {
  answerAndAdvanceSecureExam,
  getSecureExamState,
  resolveSecureExamTimeout,
  saveSecureExamAnswer,
  skipSecureExamQuestion,
  startSecureExamAttempt,
  type SecureExamQuestion,
  type SecureExamState,
} from '@/services/secureExam.service';

function formatSeconds(total: number) {
  const s = Math.max(0, total);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return hours > 0
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
    : minutes + ':' + String(seconds).padStart(2, '0');
}
function valueOf(answer: Record<string, unknown> | null | undefined) {
  return answer && typeof answer.value === 'string' ? answer.value : '';
}
function questionDeadline(state: SecureExamState | null) {
  if (!state) return null;
  if (state.phase === 'TIMEOUT_DECISION') return state.decision_deadline;
  if (state.phase === 'OVERTIME') return state.overtime_deadline;
  if (state.phase === 'ACTIVE') return state.current_deadline;
  return null;
}

export function CompetitionWorkPage() {
  const { slug = '' } = useParams();
  const { toast, isAuthenticated } = useApp();
  const [competition, setCompetition] = useState<any>(null);
  const [exam, setExam] = useState<SecureExamState | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const answerLock = useRef(false);
  const activeState = exam;
  const competitionId = String(competition?.id || '');

  const acceptState = useCallback((next: SecureExamState, restoreDraft = true) => {
    setExam(next);
    setServerOffset(Date.parse(next.server_now) - Date.now());
    setNow(Date.now());
    if (restoreDraft) setDraft(next.question?.answer && typeof next.question.answer === 'object' ? { ...next.question.answer } : {});
    answerLock.current = false;
  }, []);

  const refresh = useCallback(async () => {
    if (!activeState || !competitionId) return;
    const next = await getSecureExamState(activeState.attempt_id, competitionId);
    acceptState(next);
  }, [activeState?.attempt_id, competitionId, acceptState]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!slug || !isAuthenticated) return;
        const c = await getCompetitionBySlug(slug);
        if (!c) throw new Error('Lomba tidak ditemukan.');
        const state = await startSecureExamAttempt(c.id);
        if (!alive) return;
        setCompetition(c);
        acceptState(state);
      } catch (e: any) {
        if (alive) setError(e?.message || 'Gagal membuka ruang ujian.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [slug, isAuthenticated, acceptState]);

  useEffect(() => {
    if (!activeState || activeState.phase === 'FINISHED') return;
    let lastSync = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const deadline = questionDeadline(activeState);
      const remaining = deadline ? Math.floor((Date.parse(deadline) - (current + serverOffset)) / 1000) : null;
      if (remaining !== null && remaining <= 0 && current - lastSync > 900) {
        lastSync = current;
        void getSecureExamState(activeState.attempt_id, competitionId).then(acceptState).catch((e: any) => {
          toast(e?.message || 'Status timer belum dapat disinkronkan. Coba lagi.');
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void getSecureExamState(activeState.attempt_id, competitionId).then(acceptState).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeState?.attempt_id, activeState?.phase, activeState?.current_deadline, activeState?.decision_deadline, activeState?.overtime_deadline, activeState?.exam_deadline, competitionId, serverOffset, acceptState, toast]);

  useEffect(() => {
    if (!activeState?.question || !['ACTIVE', 'OVERTIME'].includes(activeState.phase) || activeState.phase === 'FINISHED') return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        const next = await saveSecureExamAnswer(activeState.attempt_id, competitionId, activeState.question.id, draft);
        acceptState(next, false);
      } catch (e: any) {
        toast(e?.message || 'Jawaban belum tersimpan. Tetap di halaman ini dan coba lagi.', 'error');
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft, activeState?.attempt_id, activeState?.position, activeState?.phase, competitionId, acceptState, toast]);

  const remaining = useMemo(() => {
    const deadline = questionDeadline(exam);
    if (!deadline) return 0;
    return Math.max(0, Math.ceil((Date.parse(deadline) - (now + serverOffset)) / 1000));
  }, [exam?.phase, exam?.current_deadline, exam?.decision_deadline, exam?.overtime_deadline, now, serverOffset]);

  const runAction = async (action: () => Promise<SecureExamState>, successMessage?: string) => {
    if (busy) return;
    setBusy(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    try {
      const next = await action();
      acceptState(next);
      if (successMessage) toast(successMessage, 'success');
    } catch (e: any) {
      toast(e?.message || 'Aksi gagal diproses server.', 'error');
      try { await refresh(); } catch { /* preserve the last server-confirmed state */ }
    } finally {
      setBusy(false);
    }
  };

  const submitCurrent = async () => {
    if (!exam || busy || answerLock.current) return;
    answerLock.current = true;
    await runAction(
      () => answerAndAdvanceSecureExam(exam.attempt_id, competitionId, exam.question!.id, draft),
      exam.position >= exam.total_questions ? 'Jawaban diterima server.' : 'Jawaban tersimpan. Beralih ke soal berikutnya.',
    );
  };

  const skipCurrent = async () => {
    if (!exam || busy) return;
    await runAction(() => skipSecureExamQuestion(exam.attempt_id, competitionId, exam.question!.id), 'Soal ditandai dilewati.');
  };

  const timeoutAction = (action: 'borrow' | 'grace' | 'skip') => {
    if (!exam) return;
    void runAction(
      () => resolveSecureExamTimeout(exam.attempt_id, competitionId, exam.question!.id, action),
      action === 'borrow' ? '30 detik diambil dari alokasi soal berikutnya.' : action === 'grace' ? 'Waktu tambahan 30 detik digunakan.' : 'Soal dilewati.',
    );
  };

  const uploadAnswerFile = async (file: File) => {
    if (!exam || !competitionId) return;
    setUploading(true);
    try {
      const result = await uploadRawFile(file, 'sykabelajar/answers/' + exam.attempt_id);
      const answer = { type: 'file', url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type ?? 'raw', file_name: file.name };
      setDraft(answer);
      const next = await saveSecureExamAnswer(exam.attempt_id, competitionId, exam.question!.id, answer);
      acceptState(next);
      toast('Berkas jawaban tersimpan.', 'success');
    } catch (e: any) {
      toast(e?.message || 'Berkas jawaban gagal disimpan.', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (!isAuthenticated) return <div className="p-8 text-center text-fg-secondary">Silakan login untuk mengerjakan lomba.</div>;
  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-fg-muted"><Loader2 className="animate-spin mr-2" size={20} /> Menyiapkan ruang ujian aman…</div>;
  if (error) return <div className="p-6 max-w-xl mx-auto"><Card className="p-8 text-center"><AlertTriangle className="mx-auto mb-3 text-amber-400" size={28}/><p className="text-red-300">{error}</p><Link to={competition ? '/lomba/' + competition.slug : '/home'}><Button className="mt-5">Kembali ke detail lomba</Button></Link></Card></div>;
  if (!exam || !competition) return <div className="p-8 text-center text-fg-secondary">Sesi ujian tidak tersedia.</div>;

  const q = exam.question;
  const currentValue = valueOf(draft);
  const borrowAvailable = exam.position < exam.total_questions && exam.base_seconds + exam.time_bank_seconds >= 60;
  const timerColor = remaining <= 10 ? 'text-red-400' : remaining <= 30 ? 'text-amber-300' : 'text-fg';
  const progress = Math.min(100, ((exam.position - (exam.phase === 'FINISHED' ? 0 : 1)) / exam.total_questions) * 100);
  const canEdit = Boolean(q) && (exam.phase === 'ACTIVE' || exam.phase === 'OVERTIME') && remaining > 0 && !busy;

  return <div className="min-h-screen surface-bg text-fg-secondary pb-8">
    <header className="sticky top-0 z-20 border-b surface-border surface-card-bg/95 backdrop-blur px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><ShieldCheck size={20}/></div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-fg truncate">{competition.title}</h1>
          <p className="text-xs text-fg-muted">Mode ujian berurutan · soal berikutnya terkunci sampai diputuskan server</p>
        </div>
        {exam.phase !== 'FINISHED' && <div className={'flex items-center gap-2 font-mono font-bold text-lg ' + timerColor} aria-live="off"><Clock3 size={17}/>{formatSeconds(remaining)}</div>}
      </div>
    </header>

    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-fg-muted">Kemajuan</p>
            <p className="text-sm font-semibold text-fg">{exam.phase === 'FINISHED' ? exam.total_questions : exam.position} / {exam.total_questions} soal</p>
          </div>
          <div className="flex gap-2 items-center">
            {saving && <Badge color="warn">Menyimpan…</Badge>}
            {!saving && <Badge color="moss"><Wifi size={12}/> Sinkron</Badge>}
            {exam.phase === 'OVERTIME' && <Badge color="warn"><TimerReset size={12}/> Waktu tambahan</Badge>}
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/10 mt-3 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: progress + '%' }}/></div>
      </Card>

      {exam.phase === 'FINISHED' ? (
        <Card className="p-7 md:p-10 text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><CheckCircle2 size={32}/></div>
          <h2 className="text-xl md:text-2xl font-bold text-fg">Ujian selesai</h2>
          <p className="text-sm text-fg-muted mt-2 max-w-lg mx-auto">Jawaban dan status setiap soal telah diproses di server. Nilai, kunci jawaban, dan peringkat tidak ditampilkan selama ujian dan menunggu jadwal pengumuman resmi.</p>
          <Link to={'/lomba/' + competition.slug}><Button className="mt-6">Kembali ke detail lomba</Button></Link>
        </Card>
      ) : exam.phase === 'TIMEOUT_DECISION' ? (
        <Card className="p-6 border-amber-500/40">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="text-amber-300 shrink-0 mt-1" size={24}/>
            <div className="flex-1">
              <p className="text-xs tracking-wide font-semibold text-amber-300 uppercase">Waktu soal habis</p>
              <h2 className="text-xl font-bold text-fg mt-1">Bagaimana kamu ingin melanjutkan?</h2>
              <p className="text-sm text-fg-muted mt-2">Pilih dalam {formatSeconds(remaining)}. Kamu bisa meminjam 30 detik dari soal selanjutnya, memakai sisa waktu tambahan ujian, atau melewati soal. Jika tidak memilih sampai waktu keputusan habis, server akan memberi waktu tambahan yang masih tersedia; jika tidak ada, soal otomatis dilewati.</p>
              <div className="grid sm:grid-cols-2 gap-3 mt-5">
                <Button loading={busy} disabled={!borrowAvailable || busy} onClick={() => timeoutAction('borrow')}>Ambil 30 detik dari soal berikutnya</Button>
                <Button variant="outline" loading={busy} disabled={exam.grace_remaining_seconds <= 0 || busy} onClick={() => timeoutAction('grace')}>Gunakan tambahan waktu 30 detik</Button>
                <Button variant="ghost" disabled={busy} onClick={() => timeoutAction('skip')} icon={<SkipForward size={16}/>}>Lewati soal sekarang</Button>
              </div>
              {!borrowAvailable && <p className="text-xs text-fg-muted mt-3">Pinjaman tidak tersedia karena tidak ada soal berikutnya atau waktu minimum soal berikutnya harus dijaga.</p>}
            </div>
          </div>
        </Card>
      ) : q ? (
        <Card className="p-5 md:p-7">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent font-bold flex items-center justify-center shrink-0">{exam.position}</div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge>Soal {exam.position}</Badge>
                <Badge>{q.points} poin</Badge>
                {exam.phase === 'OVERTIME' && <Badge color="warn">Waktu tambahan aktif</Badge>}
              </div>
              <div className="text-base md:text-lg font-semibold leading-relaxed text-fg whitespace-pre-wrap">{q.prompt}</div>
              {typeof q.config?.image_url === 'string' && <img src={String(q.config.image_url)} alt="Ilustrasi soal" className="mt-4 max-h-80 rounded-xl object-contain"/>}
              {typeof q.config?.media_url === 'string' && <a className="text-sm text-accent underline inline-block mt-3" href={String(q.config.media_url)} target="_blank" rel="noreferrer">Buka media soal</a>}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options.map((option) => (
              <button key={option.id} type="button" disabled={!canEdit} onClick={() => setDraft({ value: option.id })}
                className={'w-full rounded-xl border p-4 text-left flex items-center gap-3 transition ' + (currentValue === option.id ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50') + (!canEdit ? ' opacity-70 cursor-not-allowed' : '')}>
                <span className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ' + (currentValue === option.id ? 'border-accent' : 'border-fg-muted')}>{currentValue === option.id && <span className="w-2.5 h-2.5 rounded-full bg-accent"/>}</span>
                <span className="text-sm text-fg-secondary whitespace-pre-wrap">{option.label}</span>
              </button>
            ))}
            {(q.type === 'short_answer' || q.type === 'numeric') && (
              <input className="input" type={q.type === 'numeric' ? 'number' : 'text'} value={currentValue} disabled={!canEdit}
                onChange={(e) => setDraft({ value: e.target.value })} placeholder="Tulis jawabanmu…"/>
            )}
            {q.type === 'multiple_checkbox' && q.options.map((option) => {
              const selected = Array.isArray(draft.values) ? draft.values.map(String) : [];
              return <label key={option.id} className={'flex items-center gap-3 rounded-xl border p-4 ' + (selected.includes(option.id) ? 'border-accent bg-accent/10' : 'border-border') + (!canEdit ? ' opacity-70' : ' cursor-pointer')}>
                <input type="checkbox" disabled={!canEdit} checked={selected.includes(option.id)} onChange={() => setDraft({ values: selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id] })}/>
                <span className="text-sm text-fg-secondary whitespace-pre-wrap">{option.label}</span>
              </label>;
            })}
            {(q.type === 'essay' || q.type === 'long_answer') && (
              <textarea className="input min-h-40 resize-y" value={currentValue} disabled={!canEdit}
                onChange={(e) => setDraft({ value: e.target.value })} placeholder="Tuliskan jawabanmu…"/>
            )}
            {(q.type === 'file_upload' || q.type === 'file-upload') && (
              <label className="border border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer">
                <FileText size={25} className="text-accent"/>
                <span className="text-sm text-fg">{String(draft.file_name || 'Pilih berkas jawaban')}</span>
                <input className="hidden" type="file" disabled={!canEdit || uploading} onChange={(e) => { const file=e.target.files?.[0]; if(file) void uploadAnswerFile(file); e.currentTarget.value=''; }}/>
                {uploading && <span className="text-xs text-fg-muted">Mengunggah…</span>}
              </label>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-7 pt-5 border-t border-border">
            <p className="text-xs text-fg-muted">{saving ? 'Menyimpan jawaban ke server…' : 'Jawaban disimpan per soal. Soal sebelumnya terkunci dan tidak dapat dibuka kembali.'}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" disabled={busy || saving || !canEdit} onClick={() => void skipCurrent()} icon={<SkipForward size={16}/>}>Lewati</Button>
              <Button loading={busy} disabled={!canEdit || busy || saving} onClick={() => void submitCurrent()} icon={<ArrowRight size={16}/>}>Jawab & lanjut</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-7 text-center"><Loader2 size={24} className="animate-spin mx-auto mb-3"/><p className="text-sm">Menyinkronkan keputusan waktu dengan server…</p></Card>
      )}

      <p className="text-center text-xs text-fg-muted">Sesi ujian diverifikasi server. Timer browser hanya tampilan; perubahan jam perangkat tidak mengubah deadline.</p>
    </main>
  </div>;
}

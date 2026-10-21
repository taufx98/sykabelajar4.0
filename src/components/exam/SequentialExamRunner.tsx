import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { uploadRawFile } from '@/services/cloudinary.service';
import {
  advanceSequentialExam,
  getSequentialExamState,
  resolveSequentialExamTimeout,
  saveSequentialExamAnswer,
  startSequentialExam,
  type ExamMode,
  type SequentialExamState,
  type SequentialQuestion,
} from '@/services/sequentialExam.service';

type AnswerValue = string | string[];

function deadlineFor(state: SequentialExamState | null) {
  if (!state) return null;
  if (state.state === 'ACTIVE') return state.question_deadline;
  if (state.state === 'TIMEOUT_DECISION') return state.decision_deadline;
  if (state.state === 'OVERTIME') return state.overtime_deadline;
  return null;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function answerHasValue(value: AnswerValue) {
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

function normalType(type: string) {
  return type.toLowerCase().replace(/-/g, '_');
}

export function SequentialExamRunner({
  mode,
  competitionId,
  competitionTitle,
  participantLabel,
  onFinished,
}: {
  mode: ExamMode;
  competitionId: string;
  competitionTitle: string;
  participantLabel?: string;
  onFinished?: () => void;
}) {
  const [exam, setExam] = useState<SequentialExamState | null>(null);
  const [answer, setAnswer] = useState<AnswerValue>('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [answerSaved, setAnswerSaved] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);
  const deadlineRefreshInFlight = useRef(false);
  const lastDeadlineRefreshAt = useRef(0);
  const resetAnswerQuestion = useRef<string | null>(null);
  const currentQuestionId = exam?.question?.id ?? null;

  const applyExam = useCallback((next: SequentialExamState) => {
    setExam(next);
    setServerOffsetMs(new Date(next.server_now).getTime() - Date.now());
    setError('');
  }, []);

  const refresh = useCallback(async () => {
    if (!exam?.attempt_id) return;
    const next = await getSequentialExamState(exam.attempt_id, mode);
    applyExam(next);
  }, [applyExam, exam?.attempt_id, mode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const initial = await startSequentialExam(competitionId, mode);
        if (!mounted) return;
        applyExam(initial);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Gagal membuka ujian.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [competitionId, mode, applyExam]);

  useEffect(() => {
    if (currentQuestionId === resetAnswerQuestion.current) return;
    resetAnswerQuestion.current = currentQuestionId;
    setAnswer(exam?.saved_answer ?? '');
    setAnswerSaved(true);
  }, [currentQuestionId, exam?.saved_answer]); // reset only when server advances to a different question

  const activeDeadline = deadlineFor(exam);
  const countdown = useCallback(() => {
    if (!activeDeadline) return null;
    return Math.max(0, Math.ceil((new Date(activeDeadline).getTime() - (Date.now() + serverOffsetMs)) / 1000));
  }, [activeDeadline, serverOffsetMs]);

  useEffect(() => {
    const update = () => {
      const seconds = countdown();
      if (seconds === null) {
        setSecondsLeft(0);
        return;
      }
      setSecondsLeft(seconds);
      const now = Date.now();
      if (seconds === 0 && activeDeadline && exam?.attempt_id && exam.state !== 'COMPLETED'
        && !deadlineRefreshInFlight.current && now - lastDeadlineRefreshAt.current >= 2000) {
        deadlineRefreshInFlight.current = true;
        lastDeadlineRefreshAt.current = now;
        void getSequentialExamState(exam.attempt_id, mode)
          .then(applyExam)
          .catch((e) => setError(e instanceof Error ? e.message : 'Koneksi server terputus. Ujian akan disinkronkan saat koneksi kembali.'))
          .finally(() => { deadlineRefreshInFlight.current = false; });
      } else if (seconds !== null && seconds > 0) {
        deadlineRefreshInFlight.current = false;
      }
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [countdown, exam?.attempt_id, exam?.state, mode, applyExam]);

  // Do not provide in-product back navigation while the exam is active. Server ownership/state
  // checks remain the security boundary if a user closes the tab or changes browser history.
  useEffect(() => {
    if (!exam || exam.state === 'COMPLETED') return;
    const pinHistory = () => window.history.pushState({ sequentialExam: true }, '', window.location.href);
    pinHistory();
    const onPopState = () => pinHistory();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [exam?.state, exam?.attempt_id]);

  const question = exam?.question ?? null;
  const kind = normalType(question?.type ?? '');
  const isChoice = kind === 'multiple_choice' || kind === 'true_false';
  const isMultiChoice = kind === 'multiple_checkbox' || kind === 'multiple_select';
  const isLongText = kind === 'essay';
  const hasAnswer = answerHasValue(answer);
  const isTimedOut = secondsLeft === 0 && exam?.state !== 'COMPLETED';
  const progress = exam?.question_count ? Math.min(100, Math.round((exam.question_index / exam.question_count) * 100)) : 0;

  const persistAnswer = useCallback(async (q: SequentialQuestion, value: AnswerValue) => {
    if (!exam?.attempt_id) return;
    setSaving(true);
    setAnswerSaved(false);
    try {
      const next = await saveSequentialExamAnswer(exam.attempt_id, q.id, value, mode);
      applyExam(next);
      setAnswerSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Jawaban belum berhasil tersimpan.');
      try {
        const next = await getSequentialExamState(exam.attempt_id, mode);
        applyExam(next);
      } catch {
        // Keep the local input visible; another save is allowed if the server deadline remains open.
      }
    } finally {
      setSaving(false);
    }
  }, [applyExam, exam?.attempt_id, mode]);

  const changeAnswer = (nextValue: AnswerValue, immediate = false) => {
    if (!question || (exam?.state !== 'ACTIVE' && exam?.state !== 'OVERTIME')) return;
    if (secondsLeft <= 0) return;
    setAnswer(nextValue);
    setAnswerSaved(false);
    setError('');
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (immediate) {
      void persistAnswer(question, nextValue);
      return;
    }
    saveTimer.current = window.setTimeout(() => void persistAnswer(question, nextValue), 250);
  };

  const chooseTimeoutAction = async (action: 'BORROW' | 'CONTINUE') => {
    if (!exam?.attempt_id || resolving) return;
    setResolving(true);
    setError('');
    try {
      const next = await resolveSequentialExamTimeout(exam.attempt_id, action, mode);
      applyExam(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pilihan waktu gagal diproses.');
      try { await refresh(); } catch { /* Preserve state and show the original error. */ }
    } finally {
      setResolving(false);
    }
  };

  const moveNext = async () => {
    if (!exam?.attempt_id || !question || saving || !answerSaved || !hasAnswer) return;
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setResolving(true);
    setError('');
    try {
      const next = await advanceSequentialExam(exam.attempt_id, mode);
      applyExam(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal berpindah soal.');
      try { await refresh(); } catch { /* Keep the screen locked until server state can be checked. */ }
    } finally {
      setResolving(false);
    }
  };

  const uploadAnswer = async (file: File) => {
    if (!question || !exam?.attempt_id) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Ukuran file maksimal 10 MB.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadRawFile(file, `sykabelajar/exam-answers/${exam.attempt_id}`);
      const value = JSON.stringify({
        type: 'file',
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        resource_type: uploaded.resource_type ?? 'raw',
        file_name: file.name,
      });
      changeAnswer(value, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File jawaban gagal diunggah.');
    } finally {
      setUploading(false);
    }
  };

  const selectedValues = useMemo(
    () => Array.isArray(answer) ? answer : [],
    [answer],
  );

  if (loading) {
    return <div className="min-h-[60vh] flex items-center justify-center text-fg-muted"><Loader2 className="animate-spin mr-2" size={20}/>Menyiapkan sesi ujian aman…</div>;
  }

  if (error && !exam) {
    return <div className="max-w-xl mx-auto p-5"><Card className="p-6"><div className="flex items-start gap-3"><AlertTriangle className="text-red-400 mt-1" size={20}/><div><h2 className="font-semibold text-fg">Ujian tidak dapat dibuka</h2><p className="text-sm text-fg-muted mt-2">{error}</p><p className="text-xs text-fg-muted mt-3">Jika percobaan sebelumnya sudah dimulai, jangan membuka percobaan baru. Hubungi penyelenggara bila masalah berlanjut.</p></div></div></Card></div>;
  }

  if (!exam) return null;

  if (exam.state === 'COMPLETED' || !question) {
    return <div className="max-w-2xl mx-auto p-4 md:p-8"><Card className="p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-400" size={32}/></div>
      <p className="text-xs uppercase tracking-wider text-accent font-semibold">Ujian selesai</p>
      <h1 className="text-2xl font-bold text-fg mt-2">Jawaban telah dikunci</h1>
      <p className="text-sm text-fg-muted max-w-lg mx-auto mt-3">Jawaban diproses di server. Nilai, kunci jawaban, dan peringkat tidak ditampilkan sampai penyelenggara resmi mengumumkan hasil.</p>
      <div className="mt-6 flex justify-center"><Button onClick={onFinished ?? (() => { window.location.assign(mode === 'collective' ? '/peserta-kolektif' : '/home'); })}>Selesai</Button></div>
    </Card></div>;
  }

  return <div className="min-h-screen surface-bg text-fg-secondary p-4 md:p-8">
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-accent font-semibold">SYKABELAJAR · RUANG UJIAN</p>
          <h1 className="text-xl md:text-2xl font-bold text-fg mt-1">{competitionTitle}</h1>
          {participantLabel && <p className="text-xs text-fg-muted mt-1">Peserta: {participantLabel}</p>}
        </div>
        <Badge color="moss"><ShieldCheck size={13} className="mr-1"/> Mode satu arah</Badge>
      </div>

      <Card className="p-4 md:p-5 sticky top-2 z-20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-fg-muted">Soal {exam.question_index} dari {exam.question_count}</p>
            <p className="font-semibold text-fg mt-1">{exam.question_count ? Math.round((exam.question_index / exam.question_count) * 100) : 0}% selesai</p>
          </div>
          <div className={`font-mono text-xl md:text-2xl font-bold tabular-nums flex items-center gap-2 ${secondsLeft <= 10 ? 'text-red-400' : secondsLeft <= 30 ? 'text-amber-300' : 'text-fg'}`}>
            <Clock3 size={20}/>{formatDuration(secondsLeft)}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 mt-4 overflow-hidden"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }}/></div>
        <div className="flex items-center justify-between gap-3 mt-3 text-[11px] text-fg-muted">
          <span>{saving ? 'Menyimpan jawaban ke server…' : answerSaved ? 'Jawaban tersinkron ke server' : 'Menyimpan perubahan…'}</span>
          <span>{exam.time_bank_seconds > 0 ? `Sisa waktu tersimpan: ${formatDuration(exam.time_bank_seconds)}` : 'Waktu tiap soal dikendalikan server'}</span>
        </div>
      </Card>

      {error && <Card className="p-3 border border-amber-500/30 bg-amber-500/5"><p className="text-sm text-amber-200">{error}</p></Card>}

      {exam.state === 'TIMEOUT_DECISION' && <Card className="p-5 border border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3"><AlertTriangle className="text-amber-300 mt-1 shrink-0" size={22}/><div className="flex-1">
          <h2 className="font-bold text-fg">Waktu soal telah habis</h2>
          <p className="text-sm text-fg-muted mt-1">Dalam {formatDuration(secondsLeft)}, pilih apakah ingin mengambil {exam.borrow_seconds} detik dari soal selanjutnya. Jika tidak mengambil, kamu hanya mendapat waktu tambahan sesuai pengaturan lomba.</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <Button loading={resolving} disabled={resolving || !exam.can_borrow || secondsLeft <= 0} onClick={() => void chooseTimeoutAction('BORROW')}>Ambil {exam.borrow_seconds} detik</Button>
            <Button variant="outline" loading={resolving} disabled={resolving || secondsLeft <= 0} onClick={() => void chooseTimeoutAction('CONTINUE')}>Lanjut tanpa meminjam</Button>
          </div>
          {!exam.can_borrow && <p className="text-xs text-amber-200 mt-3">Waktu soal berikutnya tidak cukup untuk dipinjam, atau ini adalah soal terakhir.</p>}
        </div></div>
      </Card>}

      {exam.state === 'OVERTIME' && <Card className={`p-4 border ${exam.overtime_type === 'BORROW' ? 'border-sky-500/30 bg-sky-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
        <p className="text-sm font-semibold text-fg">{exam.overtime_type === 'BORROW' ? `Waktu tambahan ${exam.borrow_seconds} detik aktif` : 'Waktu tambahan terakhir aktif'}</p>
        <p className="text-xs text-fg-muted mt-1">{exam.overtime_type === 'BORROW' ? 'Waktu ini diambil dari jatah soal berikutnya.' : 'Jawab sekarang. Jika waktu tambahan habis, soal akan dikunci otomatis.'}</p>
      </Card>}

      <Card className="p-5 md:p-7">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-300 flex items-center justify-center font-bold shrink-0">{exam.question_index}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-3"><Badge>{question.points} poin</Badge>{question.required && <Badge color="warn">Wajib dijawab</Badge>}</div>
            <h2 className="text-lg md:text-xl font-semibold text-fg whitespace-pre-wrap leading-relaxed">{question.prompt}</h2>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {isChoice && question.options.map((option) => <label key={option.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition cursor-pointer ${answer === option.id ? 'border-emerald-400 bg-emerald-400/5' : 'border-border hover:border-emerald-400/50'} ${exam.state === 'TIMEOUT_DECISION' ? 'opacity-60' : ''}`}>
            <input type="radio" name={question.id} checked={answer === option.id} disabled={exam.state === 'TIMEOUT_DECISION' || isTimedOut || saving} onChange={() => changeAnswer(option.id, true)} className="accent-emerald-400"/>
            <span className="text-sm text-fg-secondary">{option.label}</span>
          </label>)}

          {isMultiChoice && question.options.map((option) => <label key={option.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition cursor-pointer ${selectedValues.includes(option.id) ? 'border-emerald-400 bg-emerald-400/5' : 'border-border hover:border-emerald-400/50'}`}>
            <input type="checkbox" checked={selectedValues.includes(option.id)} disabled={exam.state === 'TIMEOUT_DECISION' || isTimedOut || saving} onChange={(event) => {
              const next = event.target.checked ? [...selectedValues, option.id] : selectedValues.filter((id) => id !== option.id);
              changeAnswer(next, true);
            }} className="accent-emerald-400"/>
            <span className="text-sm text-fg-secondary">{option.label}</span>
          </label>)}

          {!isChoice && !isMultiChoice && kind !== 'file_upload' && (isLongText
            ? <textarea className="w-full min-h-40 rounded-xl border border-border bg-transparent p-4 text-sm text-fg outline-none focus:border-emerald-400/60" value={typeof answer === 'string' ? answer : ''} disabled={exam.state === 'TIMEOUT_DECISION' || isTimedOut} onChange={(event) => changeAnswer(event.target.value)} placeholder="Tulis jawabanmu…"/>
            : <input className="w-full rounded-xl border border-border bg-transparent p-4 text-sm text-fg outline-none focus:border-emerald-400/60" value={typeof answer === 'string' ? answer : ''} disabled={exam.state === 'TIMEOUT_DECISION' || isTimedOut} onChange={(event) => changeAnswer(event.target.value)} placeholder="Masukkan jawaban…"/>)}

          {kind === 'file_upload' && <label className="block rounded-xl border border-dashed border-border p-6 text-center cursor-pointer hover:border-emerald-400/50">
            <input type="file" className="hidden" disabled={uploading || exam.state === 'TIMEOUT_DECISION' || isTimedOut} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAnswer(file); event.currentTarget.value = ''; }}/>
            <FileText size={26} className="mx-auto text-fg-muted mb-2"/>
            <span className="text-sm text-fg">{uploading ? 'Mengunggah file…' : hasAnswer ? 'File jawaban telah dipilih' : 'Pilih file jawaban (maks. 10 MB)'}</span>
          </label>}
        </div>

        <div className="mt-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-fg-muted">{saving ? 'Memastikan jawaban tersimpan…' : answerSaved ? 'Jawaban terakhir diterima server.' : 'Perubahan belum dikonfirmasi server.'}</p>
          <Button loading={resolving} disabled={resolving || saving || !answerSaved || !hasAnswer || exam.state === 'TIMEOUT_DECISION' || isTimedOut} onClick={() => void moveNext()}>
            {exam.question_index === exam.question_count ? 'Kunci jawaban terakhir' : 'Kunci jawaban & lanjut'}
          </Button>
        </div>
      </Card>
      <p className="text-center text-[11px] text-fg-muted"><ShieldCheck size={13} className="inline mr-1"/>Tidak ada tombol kembali. Timer, urutan soal, dan status attempt diputuskan server.</p>
    </div>
  </div>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { uploadRawFile } from '@/services/cloudinary.service';
import {
  answerCollectiveLinearExamQuestion,
  answerLinearExamQuestion,
  getCollectiveLinearExamState,
  getLinearExamState,
  resolveCollectiveLinearExamTimeout,
  resolveLinearExamTimeout,
  saveCollectiveLinearExamDraft,
  saveLinearExamDraft,
  type LinearExamAnswer,
  type LinearExamState,
} from '@/services/linearExam.service';

type RoomMode = 'INDIVIDUAL' | 'COLLECTIVE' | 'PREVIEW';
type Props = {
  mode: RoomMode;
  title: string;
  participantName?: string;
  accessToken?: string;
  initialState: LinearExamState;
  finishHref: string;
};

function formatTime(total: number) {
  const value = Math.max(0, total);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
function phaseDeadline(state: LinearExamState) {
  return state.phase === 'ACTIVE' ? state.question_deadline ?? null : null;
}
function textValue(answer: LinearExamAnswer) {
  const value = answer.value ?? answer.text;
  return typeof value === 'string' ? value : '';
}
function hasAnswer(answer: LinearExamAnswer) {
  return Boolean(
    (typeof answer.value === 'string' && answer.value.trim()) ||
    (typeof answer.text === 'string' && answer.text.trim()) ||
    (typeof answer.url === 'string' && answer.url.trim()) ||
    (Array.isArray(answer.values) && answer.values.length)
  );
}

export function LinearExamRoom({ mode, title, participantName, accessToken = '', initialState, finishHref }: Props) {
  const { toast } = useApp();
  const [state, setState] = useState<LinearExamState>(initialState);
  const [answer, setAnswer] = useState<LinearExamAnswer>(initialState.answer ?? {});
  const [clock, setClock] = useState(0);
  const [serverOffset, setServerOffset] = useState(Date.parse(initialState.server_now) - Date.now());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [roomError, setRoomError] = useState('');
  const draftTimer = useRef<number | null>(null);
  const busyRef = useRef(false);
  const resolvingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const question = state.question;
  const deadline = phaseDeadline(state);
  const secondsLeft = useCallback((target: LinearExamState, offset: number) => {
    const due = phaseDeadline(target);
    if (!due) return 0;
    return Math.max(0, Math.ceil((Date.parse(due) - (Date.now() + offset)) / 1000));
  }, []);

  const setServerState = useCallback((next: LinearExamState) => {
    setServerOffset(Date.parse(next.server_now) - Date.now());
    setState(next);
    setRoomError('');
  }, []);

  const requestState = useCallback(async () => {
    const current = stateRef.current;
    const next = mode === 'COLLECTIVE'
      ? await getCollectiveLinearExamState(current.attempt_id, accessToken)
      : await getLinearExamState(current.attempt_id);
    setServerState(next);
  }, [accessToken, mode, setServerState]);

  useEffect(() => {
    if (!state.question) {
      setClock(0);
      return;
    }
    const tick = () => setClock(secondsLeft(stateRef.current, serverOffset));
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [deadline, serverOffset, secondsLeft, state.question?.id]);

  useEffect(() => {
    setAnswer(state.answer ?? {});
    setSaveState('idle');
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
  }, [state.position, state.question?.id]);

  const resolveTimeout = useCallback(async () => {
    if (resolvingRef.current || stateRef.current.phase === 'COMPLETED') return;
    if (secondsLeft(stateRef.current, serverOffset) > 0) return;
    resolvingRef.current = true;
    try {
      const current = stateRef.current;
      const next = mode === 'COLLECTIVE'
        ? await resolveCollectiveLinearExamTimeout(current.attempt_id, accessToken)
        : await resolveLinearExamTimeout(current.attempt_id);
      setServerState(next);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Status waktu belum berhasil diperbarui.';
      setRoomError(message);
    } finally {
      resolvingRef.current = false;
    }
  }, [accessToken, mode, secondsLeft, serverOffset, setServerState]);

  useEffect(() => {
    if (state.phase === 'COMPLETED' || clock > 0) return;
    void resolveTimeout();
  }, [clock, state.phase, resolveTimeout]);

  const saveDraft = useCallback(async (questionId: string, value: LinearExamAnswer, quiet = false) => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    setSaveState('saving');
    try {
      const current = stateRef.current;
      const next = mode === 'COLLECTIVE'
        ? await saveCollectiveLinearExamDraft(current.attempt_id, accessToken, questionId, value)
        : await saveLinearExamDraft(current.attempt_id, questionId, value);
      if (stateRef.current.question?.id === questionId) setServerState(next);
      setSaveState('saved');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Jawaban gagal disimpan.';
      if (!quiet) toast(message, 'error');
      setSaveState('idle');
      if (message.includes('QUESTION_TIMEOUT') || message.includes('EXAM_QUESTION_CHANGED')) void resolveTimeout();
    }
  }, [accessToken, mode, resolveTimeout, setServerState, toast]);

  const updateAnswer = (next: LinearExamAnswer, immediate = false) => {
    if (state.phase === 'COMPLETED' || !question || busyRef.current || state.phase !== 'ACTIVE') return;
    setAnswer(next);
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    if (immediate) {
      void saveDraft(question.id, next, true);
    } else {
      draftTimer.current = window.setTimeout(() => void saveDraft(question.id, next, true), 500);
    }
  };

  const finishQuestion = async () => {
    const current = stateRef.current;
    const currentQuestion = current.question;
    if (!currentQuestion || busyRef.current || current.phase === 'COMPLETED') return;
    if (clock <= 0) {
      await resolveTimeout();
      return;
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    busyRef.current = true;
    setBusy(true);
    try {
      const next = mode === 'COLLECTIVE'
        ? await answerCollectiveLinearExamQuestion(current.attempt_id, accessToken, currentQuestion.id, answer)
        : await answerLinearExamQuestion(current.attempt_id, currentQuestion.id, answer);
      setServerState(next);
      setSaveState('idle');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Jawaban gagal dikunci.';
      toast(message, 'error');
      if (message.includes('EXAM_QUESTION_CHANGED') || message.includes('QUESTION_TIMEOUT')) await requestState();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!question || busyRef.current) return;
    setUploading(true);
    try {
      const folder = mode === 'PREVIEW' ? `sykabelajar/preview-answers/${state.attempt_id}` : `sykabelajar/answers/${state.attempt_id}`;
      const uploaded = await uploadRawFile(file, folder);
      updateAnswer({
        type: 'file',
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        resource_type: uploaded.resource_type ?? 'raw',
        file_name: file.name,
      }, true);
      toast('File jawaban tersimpan.', 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'File gagal diunggah.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const selectedValues = Array.isArray(answer.values) ? answer.values.map(String) : [];
  const remainingProgress = state.total_questions > 0 ? Math.min(100, (state.position / state.total_questions) * 100) : 0;

  if (state.phase === 'COMPLETED') {
    return <div className="min-h-screen w-full surface-bg px-4 py-10 text-fg"><Card className="mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 size={34} className="text-emerald-500" /></div>
      <h1 className="text-xl font-bold text-fg">{mode === 'PREVIEW' ? 'Simulasi selesai' : 'Ujian selesai'}</h1>
      <p className="mt-2 text-sm text-fg-muted">{mode === 'PREVIEW' ? 'Simulasi selesai. Data uji tidak masuk ke nilai atau peringkat peserta resmi.' : 'Jawaban telah diterima oleh server. Nilai dan peringkat tidak ditampilkan sekarang dan hanya tersedia setelah penyelenggara mengumumkan hasil resmi.'}</p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.answered_count}</p><p className="text-xs text-fg-muted">Dijawab</p></div>
        <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.skipped_count}</p><p className="text-xs text-fg-muted">Dilewati</p></div>
        <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.timeout_count}</p><p className="text-xs text-fg-muted">Timeout</p></div>
      </div>
      <Link to={finishHref}><Button className="mt-6" fullWidth>{mode === 'PREVIEW' ? 'Lihat laporan simulasi' : 'Kembali ke portal'}</Button></Link>
    </Card></div>;
  }

  return <div className="fixed inset-0 z-[90] min-h-screen w-full overflow-y-auto surface-bg px-3 py-3 text-fg sm:px-5 sm:py-4">
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.18em] text-accent">RUANG UJIAN • MODE AMAN</p>
          <h1 className="mt-1 truncate text-lg font-bold text-fg sm:text-xl">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            {participantName && <span>Peserta: {participantName}</span>}
            <span>Soal {state.position} dari {state.total_questions}</span>
            <span aria-live="polite">{saveState === 'saving' ? 'Menyimpan jawaban…' : saveState === 'saved' ? 'Jawaban tersimpan sementara' : 'Perpindahan soal otomatis'}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-bold tabular-nums ${clock <= 10 ? 'bg-red-500/10 text-red-500' : 'bg-accent/10 text-accent'}`}>
            <Clock3 size={18} />
            <span>{formatTime(clock)}</span>
          </div>
          <ThemeToggle className="shrink-0 border border-border" />
        </div>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${remainingProgress}%` }} /></div>

      {roomError && <Card className="border-red-500/30 p-3"><div className="flex items-start gap-2 text-sm text-red-500"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{roomError}</span><Button variant="ghost" onClick={() => void requestState()}>Sinkronkan</Button></div></Card>}


      {question && <Card className="p-5 sm:p-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Badge>SOAL {state.position}</Badge><span className="text-xs text-fg-muted">{question.points} poin · {question.required ? 'Wajib' : 'Opsional'}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-base font-semibold leading-relaxed text-fg sm:text-lg">{question.prompt}</div>

        {(['multiple-choice', 'multiple_choice', 'single-choice', 'single_choice', 'true-false', 'true_false'].includes(question.type)) &&
          <div className="mt-6 space-y-3">{question.options.map((option) => {
            const selected = String(answer.value ?? '') === option.id;
            return <button key={option.id} type="button" disabled={busy || state.phase !== 'ACTIVE' || clock <= 0} onClick={() => updateAnswer({ value: option.id }, true)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${selected ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60'} disabled:cursor-not-allowed disabled:opacity-60`}>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-accent bg-accent text-white' : 'border-fg-muted/50'}`}>{selected ? <CheckCircle2 size={14} /> : null}</span>
              <span className="whitespace-pre-wrap text-sm text-fg-secondary">{option.label}</span>
            </button>;
          })}</div>}

        {(['multiple-checkbox', 'multiple_checkbox', 'multiple-select', 'multiple_select'].includes(question.type)) &&
          <div className="mt-6 space-y-3">{question.options.map((option) => {
            const selected = selectedValues.includes(option.id);
            return <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${selected ? 'border-accent bg-accent/10' : 'border-border'}`}>
              <input type="checkbox" checked={selected} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0} onChange={() => updateAnswer({ values: selected ? selectedValues.filter((id) => id !== option.id) : [...selectedValues, option.id] }, true)} />
              <span className="whitespace-pre-wrap text-sm text-fg-secondary">{option.label}</span>
            </label>;
          })}</div>}

        {(question.type === 'short-answer' || question.type === 'short_answer' || question.type === 'numeric' || question.type === 'short_text') &&
          <div className="mt-6"><input className="input w-full" value={textValue(answer)} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0} onChange={(event) => updateAnswer({ value: event.target.value })} placeholder="Tulis jawaban di sini…" inputMode={question.type === 'numeric' ? 'decimal' : 'text'} /></div>}

        {(question.type === 'essay' || question.type === 'long-answer' || question.type === 'long_answer') &&
          <div className="mt-6"><textarea className="input min-h-40 w-full resize-y" value={textValue(answer)} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0} onChange={(event) => updateAnswer({ value: event.target.value })} placeholder="Tuliskan jawabanmu…" /></div>}

        {(question.type === 'file-upload' || question.type === 'file_upload') &&
          <div className="mt-6"><label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center hover:border-accent">
            <input className="hidden" type="file" disabled={busy || uploading || state.phase !== 'ACTIVE' || clock <= 0} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.currentTarget.value = ''; }} />
            {uploading ? <Loader2 className="animate-spin text-accent" /> : <FileText className="text-accent" size={24} />}
            <span className="text-sm font-semibold text-fg">{String(answer.file_name ?? 'Pilih berkas jawaban')}</span>
            <span className="text-xs text-fg-muted">Berkas dikirim ke penyimpanan lalu direferensikan di jawaban ujian.</span>
          </label></div>}

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-fg-muted" aria-live="polite">
            {saveState === 'saving' ? <><Loader2 size={14} className="animate-spin" /> Menyimpan draft…</> : saveState === 'saved' ? <><ShieldCheck size={14} className="text-emerald-500" /> Draft tersimpan di server</> : <><ShieldCheck size={14} /> Timer dan perpindahan soal dikendalikan server</>}
          </div>
          <Button onClick={() => void finishQuestion()} loading={busy} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0}>
            {state.position === state.total_questions ? 'Kunci jawaban & selesaikan' : hasAnswer(answer) ? 'Kunci jawaban & lanjut' : 'Lanjut tanpa jawaban'}
          </Button>
        </div>
        {!hasAnswer(answer) && state.phase === 'ACTIVE' && <p className="mt-2 text-right text-xs text-fg-muted">Soal kosong akan tercatat sebagai skip. Jika waktu habis, sistem melanjutkan otomatis.</p>}
      </Card>}

      {!question && <Card className="p-6 text-center"><Loader2 className="mx-auto animate-spin text-accent" /><p className="mt-3 text-sm text-fg-muted">Mengambil status soal dari server…</p></Card>}
    </div>
  </div>;
}

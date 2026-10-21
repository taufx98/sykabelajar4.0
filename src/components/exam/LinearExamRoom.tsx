import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock3, FileText, Info, Loader2, ShieldCheck, SkipForward, Trophy } from 'lucide-react';
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
  subtitle?: string;
  participantName?: string;
  accessToken?: string;
  initialState: LinearExamState;
  finishHref: string;
};

function formatTime(total: number) {
  const value = Math.max(0, total);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
function formatTotalTime(total: number) {
  const value = Math.max(0, total);
  if (value < 3600) return formatTime(value);
  const hours = Math.floor(value / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((value % 3600) / 60).toString().padStart(2, '0');
  const seconds = (value % 60).toString().padStart(2, '0');
  return hours + ':' + minutes + ':' + seconds;
}
function phaseDeadline(state: LinearExamState) {
  return state.phase === 'ACTIVE' ? state.question_deadline ?? null : null;
}
function questionTypeLabel(type: string) {
  const normalized = type.toLowerCase().replaceAll('-', '_');
  if (['multiple_choice', 'single_choice', 'true_false'].includes(normalized)) return 'Pilihan Ganda';
  if (['multiple_checkbox', 'multiple_select'].includes(normalized)) return 'Pilihan Ganda Kompleks';
  if (['short_answer', 'short_text', 'numeric'].includes(normalized)) return 'Isian Singkat';
  if (['essay', 'long_answer'].includes(normalized)) return 'Uraian';
  if (normalized === 'file_upload') return 'Unggah Berkas';
  return 'Soal';
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

export function LinearExamRoom({ mode, title, subtitle, participantName, accessToken = '', initialState, finishHref }: Props) {
  const { toast } = useApp();
  const [state, setState] = useState<LinearExamState>(initialState);
  const [answer, setAnswer] = useState<LinearExamAnswer>(initialState.answer ?? {});
  const [clock, setClock] = useState(0);
  const [totalClock, setTotalClock] = useState(0);
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
      setTotalClock(0);
      return;
    }
    const tick = () => {
      const current = stateRef.current;
      setClock(secondsLeft(current, serverOffset));
      const globalDue = current.global_deadline;
      setTotalClock(globalDue
        ? Math.max(0, Math.ceil((Date.parse(globalDue) - (Date.now() + serverOffset)) / 1000))
        : 0);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [deadline, state.global_deadline, serverOffset, secondsLeft, state.question?.id]);

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

  const finishQuestion = async (skip = false) => {
    const current = stateRef.current;
    const currentQuestion = current.question;
    if (!currentQuestion || busyRef.current || current.phase === 'COMPLETED') return;
    if (clock <= 0 || totalClock <= 0) {
      await resolveTimeout();
      return;
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    busyRef.current = true;
    setBusy(true);
    try {
      const next = mode === 'COLLECTIVE'
        ? await answerCollectiveLinearExamQuestion(current.attempt_id, accessToken, currentQuestion.id, skip ? {} : answer, skip)
        : await answerLinearExamQuestion(current.attempt_id, currentQuestion.id, skip ? {} : answer, skip);
      setAnswer({});
      setServerState(next);
      setSaveState('idle');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : skip ? 'Soal gagal dilewati.' : 'Jawaban gagal dikunci.';
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
  const normalizedType = question?.type.toLowerCase().replaceAll('-', '_') ?? '';
  const multipleChoice = ['multiple_choice', 'single_choice', 'true_false'].includes(normalizedType);
  const multipleSelect = ['multiple_checkbox', 'multiple_select'].includes(normalizedType);
  const themeTitle = subtitle?.trim() || (mode === 'PREVIEW' ? 'Simulasi penyelenggara' : participantName ? 'Peserta: ' + participantName : 'Ruang ujian resmi');

  if (state.phase === 'COMPLETED') {
    return <div className="fixed inset-0 z-[90] flex min-h-screen w-full items-center justify-center overflow-y-auto surface-bg px-4 py-8 text-fg">
      <Card className="mx-auto w-full max-w-xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 size={34} className="text-emerald-500" /></div>
        <h1 className="text-xl font-bold text-fg">{mode === 'PREVIEW' ? 'Simulasi selesai' : 'Ujian selesai'}</h1>
        <p className="mt-2 text-sm text-fg-muted">{mode === 'PREVIEW' ? 'Simulasi selesai. Data uji tidak masuk ke nilai atau peringkat peserta resmi.' : 'Jawaban telah diterima oleh server. Nilai dan peringkat tersedia setelah penyelenggara mengumumkan hasil resmi.'}</p>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.answered_count}</p><p className="text-xs text-fg-muted">Dijawab</p></div>
          <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.skipped_count}</p><p className="text-xs text-fg-muted">Dilewati</p></div>
          <div className="rounded-xl border border-border p-3"><p className="text-xl font-bold text-fg">{state.timeout_count}</p><p className="text-xs text-fg-muted">Timeout</p></div>
        </div>
        <Link to={finishHref}><Button className="mt-6" fullWidth>{mode === 'PREVIEW' ? 'Lihat laporan simulasi' : 'Kembali ke portal'}</Button></Link>
      </Card>
    </div>;
  }

  return <div className="fixed inset-0 z-[90] flex h-[100dvh] min-h-screen w-full flex-col overflow-hidden surface-bg text-fg">
    <header className="relative z-10 flex shrink-0 flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:min-h-[84px] sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-6 md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500">
          <Trophy size={28} strokeWidth={2.1} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold leading-tight text-fg sm:text-lg">{title}</h1>
          <p className="mt-1 truncate text-xs text-fg-muted sm:text-sm">{themeTitle}</p>
        </div>
      </div>

      <div className="order-first flex items-center justify-center sm:absolute sm:left-1/2 sm:top-1/2 sm:order-none sm:-translate-x-1/2 sm:-translate-y-1/2">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-elevated/30 px-4 py-2 text-xs font-semibold text-fg sm:text-sm">
          <ClipboardList size={19} className="text-accent" />
          <span>Soal {state.position} dari {state.total_questions}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 sm:min-w-[190px] sm:justify-end sm:gap-4">
        <div className="flex items-center gap-3">
          <Clock3 size={27} className={totalClock <= 60 ? 'text-red-500' : 'text-accent'} strokeWidth={1.9} />
          <div>
            <p className={'font-mono text-xl font-bold leading-tight tabular-nums sm:text-2xl ' + (totalClock <= 60 ? 'text-red-500' : 'text-fg')} aria-live="off">{formatTotalTime(totalClock)}</p>
            <p className="mt-0.5 text-[11px] text-fg-muted sm:text-xs">Waktu tersisa</p>
          </div>
        </div>
        <ThemeToggle className="shrink-0 border border-border" />
      </div>
    </header>

    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[940px] px-5 pb-8 pt-8 sm:px-8 sm:pt-10 md:px-10 md:pt-12">
        {roomError && <Card className="mb-5 border-red-500/30 p-3"><div className="flex items-start gap-2 text-sm text-red-500"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{roomError}</span><Button variant="ghost" size="sm" onClick={() => void requestState()}>Sinkronkan</Button></div></Card>}

        {question && <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">{questionTypeLabel(question.type)}</span>
            <div className="flex items-center gap-2.5 text-xs sm:text-sm">
              <span className="text-fg-muted">Kerjakan soal ini sebelum</span>
              <span className={'rounded-lg border px-3 py-1.5 font-mono text-base font-bold tabular-nums ' + (clock <= 10 ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-accent/25 bg-accent/10 text-accent')}>{formatTime(clock)}</span>
            </div>
          </div>

          <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 sm:grid-cols-[32px_minmax(0,1fr)] sm:gap-4">
            <span className="pt-0.5 text-lg font-bold leading-relaxed text-fg sm:text-xl">{state.position}.</span>
            <div>
              <h2 className="whitespace-pre-wrap break-words text-base font-semibold leading-[1.7] text-fg sm:text-[19px]">{question.prompt}</h2>
              <p className="mt-2 text-xs text-fg-muted">{question.points} poin{question.required ? ' · Wajib dijawab' : ' · Opsional'}</p>
            </div>
          </div>

          {multipleChoice && <div className="mt-6 space-y-3">
            {question.options.map((option, index) => {
              const selected = String(answer.value ?? '') === option.id;
              return <button key={option.id} type="button" disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0} onClick={() => updateAnswer({ value: option.id }, true)} className={'flex min-h-[62px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition sm:gap-4 sm:px-5 ' + (selected ? 'border-accent bg-accent/10 ring-1 ring-accent/10' : 'border-border bg-card hover:border-accent/50 hover:bg-surface-elevated/20') + ' disabled:cursor-not-allowed disabled:opacity-60'}>
                <span className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ' + (selected ? 'border-accent bg-accent' : 'border-fg-muted/50 bg-transparent')}>{selected && <span className="h-2 w-2 rounded-full bg-white" />}</span>
                <span className="min-w-0 text-sm leading-relaxed text-fg-secondary sm:text-base"><span className="mr-2 font-semibold">{String.fromCharCode(65 + index)}.</span>{option.label}</span>
              </button>;
            })}
          </div>}

          {multipleSelect && <div className="mt-6 space-y-3">
            {question.options.map((option, index) => {
              const selected = selectedValues.includes(option.id);
              return <button key={option.id} type="button" disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0} onClick={() => updateAnswer({ values: selected ? selectedValues.filter((id) => id !== option.id) : [...selectedValues, option.id] }, true)} className={'flex min-h-[62px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition sm:px-5 ' + (selected ? 'border-accent bg-accent/10 ring-1 ring-accent/10' : 'border-border bg-card hover:border-accent/50') + ' disabled:cursor-not-allowed disabled:opacity-60'}>
                <span className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ' + (selected ? 'border-accent bg-accent text-white' : 'border-fg-muted/50')}>{selected && <CheckCircle2 size={13} />}</span>
                <span className="min-w-0 text-sm leading-relaxed text-fg-secondary sm:text-base"><span className="mr-2 font-semibold">{String.fromCharCode(65 + index)}.</span>{option.label}</span>
              </button>;
            })}
          </div>}

          {(normalizedType === 'short_answer' || normalizedType === 'short_text' || normalizedType === 'numeric') && <div className="mt-6">
            <input className="input w-full" value={textValue(answer)} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0} onChange={(event) => updateAnswer({ value: event.target.value })} placeholder="Tulis jawaban di sini…" inputMode={normalizedType === 'numeric' ? 'decimal' : 'text'} />
          </div>}

          {(normalizedType === 'essay' || normalizedType === 'long_answer') && <div className="mt-6">
            <textarea className="input min-h-40 w-full resize-y" value={textValue(answer)} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0} onChange={(event) => updateAnswer({ value: event.target.value })} placeholder="Tuliskan jawabanmu…" />
          </div>}

          {normalizedType === 'file_upload' && <div className="mt-6">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center hover:border-accent">
              <input className="hidden" type="file" disabled={busy || uploading || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.currentTarget.value = ''; }} />
              {uploading ? <Loader2 className="animate-spin text-accent" /> : <FileText className="text-accent" size={24} />}
              <span className="text-sm font-semibold text-fg">{String(answer.file_name ?? 'Pilih berkas jawaban')}</span>
              <span className="text-xs text-fg-muted">Berkas akan disimpan lalu ditautkan ke jawaban ujian.</span>
            </label>
          </div>}

          <div className="mt-8 flex items-start gap-3 rounded-xl border border-accent/10 bg-accent/5 px-4 py-4 sm:px-5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Info size={16} /></span>
            <p className="text-xs leading-5 text-fg-muted sm:text-sm sm:leading-6">
              {hasAnswer(answer)
                ? 'Periksa kembali pilihanmu. Setelah dikunci, jawaban tidak dapat diubah dan kamu langsung berpindah ke soal berikutnya.'
                : 'Pilih jawaban yang paling tepat. Soal kosong atau waktu habis akan tercatat sebagai SKIP dengan nilai 0.'}
            </p>
          </div>
        </>}
        
        {!question && <Card className="p-6 text-center"><Loader2 className="mx-auto animate-spin text-accent" /><p className="mt-3 text-sm text-fg-muted">Mengambil status soal dari server…</p></Card>}
      </div>
    </main>

    <footer className="z-10 flex shrink-0 flex-col gap-3 border-t border-border bg-card px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-8">
      <div className="flex items-center gap-2 text-xs text-fg-muted sm:text-sm">
        <ShieldCheck size={17} className="shrink-0 text-accent" />
        <span>{saveState === 'saving' ? 'Menyimpan jawaban…' : saveState === 'saved' ? 'Draft jawaban tersimpan' : 'Jawaban dikunci satu per satu; soal sebelumnya tidak bisa dibuka lagi.'}</span>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Button variant="outline" className="w-full sm:w-auto sm:min-w-[150px]" onClick={() => void finishQuestion(true)} loading={busy} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0 || !question} icon={<SkipForward size={16} />}>
          {state.position === state.total_questions ? 'Lewati & selesaikan' : 'Lewati soal'}
        </Button>
        <Button className="w-full sm:w-auto sm:min-w-[250px]" onClick={() => void finishQuestion(false)} loading={busy} disabled={busy || state.phase !== 'ACTIVE' || clock <= 0 || totalClock <= 0 || !question || !hasAnswer(answer)} icon={<ArrowRight size={17} />}>
          {state.position === state.total_questions ? 'Kunci jawaban & selesaikan' : 'Kunci jawaban & selanjutnya'}
        </Button>
      </div>
    </footer>
  </div>;
}

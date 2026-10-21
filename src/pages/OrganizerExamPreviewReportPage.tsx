import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

function answerText(answer: any, question: any, evaluation: any): string {
  if (typeof evaluation?.answer_text === 'string' && evaluation.answer_text.trim()) return evaluation.answer_text;
  if (!answer || typeof answer !== 'object') return 'Tidak dijawab';
  const options = Array.isArray(question?.options) ? question.options : [];
  const labelFor = (value: unknown) => {
    const raw = String(value ?? '');
    const option = options.find((item: any) => String(item.id) === raw);
    if (option) return String(option.label ?? 'Pilihan');
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw) ? 'Pilihan tidak ditemukan' : raw;
  };
  if (Array.isArray(answer.values) && answer.values.length) return answer.values.map(labelFor).join(' · ');
  const value = answer.value ?? answer.text ?? answer.file_name ?? answer.url;
  return typeof value === 'string' && value.trim() ? labelFor(value) : 'Tidak dijawab';
}

function resultPresentation(item: any) {
  const status = String(item?.evaluation?.result_status ?? '');
  if (status === 'CORRECT') return { label: 'Benar', card: 'border-emerald-500/40 bg-emerald-500/5', badge: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' };
  if (status === 'INCORRECT') return { label: 'Salah', card: 'border-red-500/40 bg-red-500/5', badge: 'text-red-600 dark:text-red-400 bg-red-500/10' };
  if (status === 'SKIPPED') return { label: 'Dilewati', card: 'border-border bg-transparent', badge: 'text-fg-muted bg-fg/5' };
  if (status === 'TIMEOUT') return { label: 'Waktu habis', card: 'border-border bg-transparent', badge: 'text-fg-muted bg-fg/5' };
  if (status === 'MANUAL_REVIEW') return { label: 'Perlu penilaian', card: 'border-border bg-transparent', badge: 'text-amber-600 dark:text-amber-300 bg-amber-500/10' };
  return { label: 'Tidak dijawab', card: 'border-border bg-transparent', badge: 'text-fg-muted bg-fg/5' };
}

function keyText(question: any, key: any): string {
  const options = Array.isArray(question?.options) ? question.options : [];
  const ids = Array.isArray(key?.correct_option_ids) ? key.correct_option_ids.map(String) : [];
  if (ids.length) {
    return ids.map((id: string) => {
      const option = options.find((item: any) => String(item.id) === id);
      return option ? String(option.label) : 'Pilihan tidak ditemukan';
    }).join(' · ');
  }
  if (Array.isArray(key?.accepted_answers) && key.accepted_answers.length) return key.accepted_answers.join(' · ');
  if (typeof key?.answer_key === 'string' && key.answer_key.trim()) return key.answer_key;
  return 'Tidak ada kunci otomatis; perlu pemeriksaan manual.';
}

export function OrganizerExamPreviewReportPage() {
  const { id = '', attemptId = '' } = useParams();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setReport(null);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_organizer_exam_preview_report', { p_attempt_id: attemptId });
        if (rpcError) throw rpcError;
        if (!data || typeof data !== 'object') throw new Error('Laporan simulasi tidak valid.');
        if (active) setReport(data);
      } catch (cause: unknown) {
        if (active) setError(cause instanceof Error ? cause.message : 'Gagal memuat laporan simulasi.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [attemptId]);

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-fg-muted"><Loader2 className="mr-2 animate-spin" size={20}/> Memuat laporan simulasi…</div>;
  if (error || !report) return <div className="p-5 md:p-8"><Card className="mx-auto max-w-xl p-6 text-center"><p className="text-sm text-fg-muted">{error || 'Laporan tidak ditemukan.'}</p><Link to={`/organizer/competition/${id}/config`}><Button className="mt-4">Kembali ke konfigurasi</Button></Link></Card></div>;

  const questions = Array.isArray(report.questions) ? report.questions : [];
  const maxScore = Number(report.maximum_score ?? 0);
  const score = Number(report.score ?? 0);
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return <div className="min-h-screen surface-bg p-4 md:p-8 text-fg">
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to={`/organizer/competition/${id}/config`} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg"><ArrowLeft size={16}/> Kembali ke konfigurasi</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-wider text-accent">Laporan simulasi</p><h1 className="mt-1 text-2xl md:text-3xl font-bold">{report.competition_title || 'Simulasi ujian'}</h1><p className="mt-1 text-sm text-fg-muted">Data uji, bukan hasil lomba resmi.</p></div>
        <Badge>SIMULASI</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-fg-muted">Perkiraan nilai otomatis</p><p className="mt-1 text-2xl font-bold">{score} / {maxScore}</p><p className="text-xs text-fg-muted">{percent}% dari poin maksimum</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Terjawab</p><p className="mt-1 text-2xl font-bold">{report.answered_count ?? 0} / {questions.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Dilewati</p><p className="mt-1 text-2xl font-bold">{report.skipped_count ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Timeout</p><p className="mt-1 text-2xl font-bold">{report.timeout_count ?? 0}</p></Card>
      </div>
      {Number(report.manual_review_count ?? 0) > 0 && <Card className="p-4 border-amber-500/30"><p className="font-semibold">Ada {report.manual_review_count} jawaban yang memerlukan penilaian manual</p><p className="mt-1 text-sm text-fg-muted">Nilai di atas adalah hasil otomatis sementara. Karena ini simulasi, jawaban esai/berkas tidak dikirim ke antrean penilaian resmi.</p></Card>}
      <div className="space-y-3">
        {questions.map((item: any) => {
          const q = item.question ?? {};
          const presentation = resultPresentation(item);
          const evaluationStatus = String(item?.evaluation?.result_status ?? '');
          const showManualReview = evaluationStatus === 'MANUAL_REVIEW' || Boolean(item.manual_review_required);
          return <Card key={String(item.position)} className={`p-4 md:p-5 border ${presentation.card}`}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-sm font-bold text-accent">{item.position}</div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.badge}`}>{presentation.label}</span>
                  <span className="text-xs text-fg-muted">{item.points} poin</span>
                  {showManualReview && <Badge color="warn">Perlu penilaian manual</Badge>}
                </div>
                <p className="whitespace-pre-wrap break-words font-semibold">{q.prompt || 'Soal'}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className={`rounded-lg border p-3 ${evaluationStatus === 'CORRECT' ? 'border-emerald-500/35 bg-emerald-500/5' : evaluationStatus === 'INCORRECT' ? 'border-red-500/35 bg-red-500/5' : 'border-border'}`}>
                    <p className="text-xs text-fg-muted">Jawaban simulasi</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{answerText(item.answer, q, item.evaluation)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-fg-muted">Kunci jawaban / acuan</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{keyText(q, item.answer_key)}</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>;
        })}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Link to={`/organizer/competition/${id}/config`}><Button variant="outline" icon={<ArrowLeft size={16}/>}>Kembali ke konfigurasi</Button></Link>
        <Button icon={<Clock3 size={16}/>} onClick={async () => {
          setLoading(true);
          setError('');
          try {
            const { data, error: startError } = await supabase.rpc('start_organizer_exam_preview', { p_competition_id: id });
            if (startError) throw startError;
            const nextId = String((data as Record<string, unknown> | null)?.attempt_id ?? '');
            if (!nextId) throw new Error('Simulasi baru tidak berhasil dimulai.');
            window.location.assign(`/organizer/competition/${id}/simulation/${nextId}`);
          } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : 'Gagal mengulangi simulasi.');
            setLoading(false);
          }
        }}>Ulangi Simulasi</Button>
      </div>
    </div>
  </div>;
}

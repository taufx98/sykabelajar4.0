import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, Clock3, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getSecureExamMonitor, type SecureExamMonitor } from '@/services/secureExam.service';

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Aktif', ANSWERED: 'Dijawab', OVERTIME_ANSWERED: 'Dijawab saat tambahan',
    TIMEOUT: 'Timeout', TIMEOUT_PENDING: 'Timeout', TIMEOUT_DECISION: 'Memilih waktu',
    OVERTIME: 'Waktu tambahan', SKIPPED: 'Dilewati', PENDING: 'Belum dibuka',
    FINISHED: 'Selesai', GRADING: 'Penilaian', FINALIZED: 'Final',
  };
  return labels[status] || status;
}
function statusTone(status: string): 'moss' | 'warn' | 'danger' | 'default' {
  if (status === 'ANSWERED' || status === 'OVERTIME_ANSWERED' || status === 'FINALIZED') return 'moss';
  if (status === 'TIMEOUT' || status === 'TIMEOUT_PENDING' || status === 'TIMEOUT_DECISION' || status === 'SKIPPED') return 'danger';
  if (status === 'OVERTIME' || status === 'GRADING') return 'warn';
  return 'default';
}
function formatElapsed(seconds: number) {
  const s = Math.max(0, seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function OrganizerExamMonitorPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<SecureExamMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const next = await getSecureExamMonitor(id);
      setData(next);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat pemantauan ujian. Pastikan akses Organizer/Admin benar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const attempts = data?.attempts || [];
  const activeCount = attempts.filter(a => a.phase !== 'FINISHED').length;
  const timeoutCount = attempts.reduce((sum, a) => sum + a.timeout_count, 0);
  const skippedCount = attempts.reduce((sum, a) => sum + a.skipped_count, 0);
  const answeredCount = attempts.reduce((sum, a) => sum + a.answered_count, 0);

  return <div className="min-h-screen surface-bg p-4 md:p-8">
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={'/organizer/competition/' + id + '/config'} className="text-sm text-fg-muted hover:text-fg">← Konfigurasi lomba</Link>
          <p className="text-xs uppercase tracking-wider text-accent mt-4">Organizer · Exam Control</p>
          <h1 className="text-2xl md:text-3xl font-bold text-fg mt-1">Pemantauan Ujian</h1>
          <p className="text-sm text-fg-muted mt-2">Status soal, timeout, skip, waktu tambahan, dan sesi peserta. Jawaban serta nilai tidak ditampilkan di panel ini.</p>
        </div>
        <Button variant="outline" loading={refreshing} onClick={() => void load(true)} icon={<RefreshCw size={15}/>}>Perbarui</Button>
      </div>

      {error && <Card className="p-4 border-red-500/30"><div className="flex gap-2 items-center text-red-300"><AlertTriangle size={18}/><span className="text-sm">{error}</span></div></Card>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-xs text-fg-muted">Peserta terpantau</p><p className="text-2xl font-bold text-fg mt-1">{attempts.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Sesi berjalan</p><p className="text-2xl font-bold text-fg mt-1">{activeCount}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Timeout tercatat</p><p className="text-2xl font-bold text-amber-300 mt-1">{timeoutCount}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-muted">Soal dilewati</p><p className="text-2xl font-bold text-red-300 mt-1">{skippedCount}</p></Card>
      </div>

      {loading ? <Card className="p-12 flex items-center justify-center gap-3 text-fg-muted"><Loader2 className="animate-spin" size={20}/> Memuat status server…</Card> : attempts.length === 0 ? <Card className="p-10 text-center"><Activity className="mx-auto text-fg-muted mb-3" size={28}/><h2 className="font-semibold text-fg">Belum ada sesi ujian</h2><p className="text-sm text-fg-muted mt-2">Peserta akan muncul setelah memulai ujian melalui Exam Engine.</p></Card> : <div className="space-y-4">
        {attempts.map(attempt => <Card key={attempt.attempt_id} className="p-4 md:p-5">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="lg:w-64 shrink-0">
              <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-accent"/><h2 className="font-semibold text-fg">{attempt.participant_name}</h2></div>
              <div className="flex flex-wrap gap-2 mt-2"><Badge>{attempt.participant_type === 'COLLECTIVE' ? 'Kolektif' : 'Individual'}</Badge><Badge color={statusTone(attempt.phase)}>{statusLabel(attempt.phase)}</Badge></div>
              <p className="text-xs text-fg-muted mt-3">Soal {Math.min(attempt.current_position, attempt.total_questions)} / {attempt.total_questions}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-fg-muted">
                <span>{attempt.answered_count} dijawab</span>
                <span>{attempt.timeout_count} timeout</span>
                <span>{attempt.skipped_count} skip</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-fg-muted mb-3"><Clock3 size={14}/> Rincian status setiap soal</div>
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 xl:grid-cols-12 gap-2">
                {attempt.questions.map(question => <div key={question.position} title={'Soal ' + question.position + ': ' + statusLabel(question.status) + (question.spent_seconds ? ' · ' + formatElapsed(question.spent_seconds) : '')}
                  className={'min-h-[58px] rounded-lg border p-2 flex flex-col items-center justify-center gap-1 ' +
                    (question.status === 'ANSWERED' || question.status === 'OVERTIME_ANSWERED' ? 'border-emerald-500/40 bg-emerald-500/10' :
                      question.status === 'SKIPPED' || question.status === 'TIMEOUT' || question.status === 'TIMEOUT_PENDING' || question.status === 'TIMEOUT_DECISION' ? 'border-red-500/40 bg-red-500/10' :
                        question.status === 'OVERTIME' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border')}>
                  <span className="text-xs font-bold text-fg">{question.position}</span>
                  <span className="text-[10px] text-center leading-tight text-fg-muted">{statusLabel(question.status)}</span>
                  {question.spent_seconds > 0 && <span className="text-[9px] text-fg-muted">{formatElapsed(question.spent_seconds)}</span>}
                </div>)}
              </div>
            </div>
          </div>
        </Card>)}
      </div>}
      <p className="text-xs text-fg-muted text-center">Panel memperbarui data setiap 10 detik ketika tab aktif. Data dibatasi ke 200 sesi terbaru. Total jawaban tersimpan: {answeredCount}.</p>
    </div>
  </div>;
}

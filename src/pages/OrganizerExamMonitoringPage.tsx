import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Loader2, RefreshCw, TimerReset, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getLinearExamActivity, type LinearExamActivity, type LinearExamActivityEvent, type LinearExamActivityParticipant } from '@/services/linearExam.service';

function labelEvent(event: LinearExamActivityEvent) {
  const map: Record<string, string> = {
    ATTEMPT_STARTED: 'Ujian dimulai',
    QUESTION_OPENED: 'Soal dibuka',
    ANSWER_DRAFT_SAVED: 'Draft jawaban tersimpan',
    QUESTION_TIMEOUT: 'Waktu soal habis',
    TIMEOUT_DECISION_OPENED: 'Pilihan waktu dibuka',
    BORROW_ACCEPTED: 'Meminjam 30 detik dari soal berikutnya',
    BORROW_DECLINED: 'Tidak meminjam waktu',
    DECISION_TIMEOUT: 'Waktu memilih habis',
    QUESTION_GRACE_STARTED: 'Waktu tambahan dimulai',
    QUESTION_ANSWERED: 'Soal dijawab',
    QUESTION_SKIPPED: 'Soal dilewati',
    ATTEMPT_COMPLETED: 'Ujian selesai',
  };
  return map[event.event_type] ?? event.event_type.replaceAll('_', ' ').toLowerCase();
}
function phaseLabel(value: string) {
  const map: Record<string, string> = { ACTIVE: 'Mengerjakan', DECISION: 'Memilih waktu', GRACE: 'Waktu tambahan', COMPLETED: 'Selesai', IN_PROGRESS: 'Berlangsung', FINALIZED: 'Selesai', GRADING: 'Menunggu penilaian' };
  return map[value] ?? value;
}
function phaseColor(value: string): 'moss' | 'warn' | 'danger' | 'default' {
  if (value === 'COMPLETED' || value === 'FINALIZED') return 'moss';
  if (value === 'DECISION' || value === 'GRACE') return 'warn';
  if (value === 'ACTIVE' || value === 'IN_PROGRESS') return 'default';
  return 'danger';
}
function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)); }
  catch { return value; }
}
function ParticipantCard({ participant }: { participant: LinearExamActivityParticipant }) {
  const latest = participant.events.slice(0, 5);
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
      <div className="min-w-0">
        <p className="font-semibold text-fg">{participant.participant_name}</p>
        <p className="mt-1 text-xs text-fg-muted">{participant.participant_kind === 'COLLECTIVE' ? 'Peserta kolektif' : 'Peserta individual'} · Soal {participant.current_position}/{participant.total_questions}</p>
      </div>
      <Badge color={phaseColor(participant.phase)}>{phaseLabel(participant.phase)}</Badge>
    </div>
    <div className="grid grid-cols-3 gap-2 p-4">
      <div className="rounded-xl bg-surface-elevated/50 p-3"><p className="text-xl font-bold text-fg">{participant.answered_count}</p><p className="text-xs text-fg-muted">Dijawab</p></div>
      <div className="rounded-xl bg-surface-elevated/50 p-3"><p className="text-xl font-bold text-fg">{participant.skipped_count}</p><p className="text-xs text-fg-muted">Skip</p></div>
      <div className="rounded-xl bg-surface-elevated/50 p-3"><p className="text-xl font-bold text-fg">{participant.timeout_count}</p><p className="text-xs text-fg-muted">Timeout</p></div>
    </div>
    {latest.length > 0 && <div className="px-4 pb-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Riwayat terbaru</p><div className="space-y-2">{latest.map((event,index)=><div key={`${event.occurred_at}-${event.event_type}-${index}`} className="flex items-start gap-2 text-xs"><span className="font-mono text-fg-muted">{formatDate(event.occurred_at)}</span><span className={event.event_type.includes('TIMEOUT') || event.event_type.includes('SKIPPED') ? 'text-amber-500' : 'text-fg-secondary'}>{labelEvent(event)}{event.position ? ` · Soal ${event.position}` : ''}</span></div>)}</div></div>}
  </Card>;
}
export function OrganizerExamMonitoringPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<LinearExamActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (manual = false) => {
    if (!id) { setError('ID lomba tidak valid.'); setLoading(false); return; }
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      const next = await getLinearExamActivity(id);
      setData(next);
      setError('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat aktivitas ujian.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const participants = data?.participants ?? [];
  const active = participants.filter((x) => x.phase !== 'COMPLETED').length;
  const totalAnswered = participants.reduce((sum, x) => sum + x.answered_count, 0);
  const totalSkipped = participants.reduce((sum, x) => sum + x.skipped_count, 0);
  const totalTimeouts = participants.reduce((sum, x) => sum + x.timeout_count, 0);

  return <div className="min-h-screen surface-bg p-4 md:p-7">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/organizer" className="mb-3 inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Organizer</Link>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Live exam operations</p>
          <h1 className="mt-1 text-2xl font-bold text-fg">Pemantauan ujian</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">Pantau progress, timeout, skip, dan keputusan peminjaman waktu. Panel ini tidak menampilkan jawaban maupun skor peserta.</p>
        </div>
        <Button onClick={() => void load(true)} disabled={loading || refreshing} loading={refreshing} icon={<RefreshCw size={15}/>}>Perbarui data</Button>
      </div>

      {error && <Card className="border-red-500/30 p-4"><div className="flex items-start gap-2 text-sm text-red-500"><AlertTriangle size={18} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Pemantauan belum tersedia</p><p className="mt-1 break-words">{error}</p></div></div></Card>}

      {data && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Card className="p-4"><div className="flex items-center gap-3"><Users className="text-accent"/><div><p className="text-xs text-fg-muted">Sesi terpantau</p><p className="text-2xl font-bold text-fg">{participants.length}</p></div></div></Card>
          <Card className="p-4"><div className="flex items-center gap-3"><Activity className="text-accent"/><div><p className="text-xs text-fg-muted">Masih berlangsung</p><p className="text-2xl font-bold text-fg">{active}</p></div></div></Card>
          <Card className="p-4"><div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-500"/><div><p className="text-xs text-fg-muted">Soal dijawab</p><p className="text-2xl font-bold text-fg">{totalAnswered}</p></div></div></Card>
          <Card className="p-4"><div className="flex items-center gap-3"><AlertTriangle className="text-amber-500"/><div><p className="text-xs text-fg-muted">Timeout / skip</p><p className="text-2xl font-bold text-fg">{totalTimeouts} / {totalSkipped}</p></div></div></Card>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted"><Clock3 size={14}/> Data terakhir diperbarui {formatDate(data.generated_at)}. Gunakan tombol Perbarui data untuk menyegarkan tampilan; refresh sekaligus meminta backend memproses deadline yang sudah lewat.</div>
        {participants.length === 0
          ? <Card className="p-10 text-center"><Activity className="mx-auto text-fg-muted" size={30}/><h2 className="mt-3 font-semibold text-fg">Belum ada sesi ujian</h2><p className="mt-1 text-sm text-fg-muted">Peserta akan muncul setelah memulai ujian dengan engine baru.</p></Card>
          : <div className="grid gap-4 xl:grid-cols-2">{participants.map((participant) => <ParticipantCard key={participant.attempt_id} participant={participant}/>)}</div>}
      </>}

      {loading && !data && <Card className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-accent" size={28}/><p className="mt-3 text-sm text-fg-muted">Memuat data aktivitas…</p></Card>}
    </div>
  </div>;
}

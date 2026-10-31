import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Award, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw, ShieldAlert, Trophy, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/lib/toast';
import {
  getOrganizerCompetitionResults,
  publishCompetitionResults,
  startCompetitionGrading,
  type OrganizerCompetitionResultsOverview,
} from '@/services/competitionResults.service';

function formatDate(value?: string | null) {
  if (!value) return 'Belum ditentukan';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date) + ' WIB';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    SUBMISSION_CLOSED: 'Pengumpulan ditutup',
    GRADING: 'Penilaian berlangsung',
    RESULT_PUBLISHED: 'Hasil diumumkan',
    ARCHIVED: 'Diarsipkan',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function SummaryCard({
  label, value, icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">{icon}</span>
      <span className="min-w-0">
        <strong className="block text-2xl font-bold tabular-nums text-fg">{value.toLocaleString('id-ID')}</strong>
        <span className="block truncate text-[11px] text-fg-muted">{label}</span>
      </span>
    </Card>
  );
}

export function OrganizerCompetitionResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [overview, setOverview] = useState<OrganizerCompetitionResultsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!id) {
      setError('ID lomba tidak ditemukan.');
      setLoading(false);
      return;
    }
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setOverview(await getOrganizerCompetitionResults(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat rekap hasil lomba.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginGrading = async () => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await startCompetitionGrading(id);
      toast.success('Lomba masuk ke tahap penilaian.');
      await load(true);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal memulai penilaian.');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!id || busy || !overview?.readiness.can_publish) return;
    const confirmed = window.confirm(
      'Terbitkan hasil resmi sekarang? Nilai dan peringkat akan dapat dilihat publik dan peserta.',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await publishCompetitionResults(id);
      toast.success(result.already_published ? 'Hasil lomba sudah diterbitkan.' : 'Hasil resmi berhasil diterbitkan.');
      await load(true);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal menerbitkan hasil.');
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!id || !overview || loadingMore || overview.results.length >= overview.readiness.result_count) return;
    setLoadingMore(true);
    try {
      const next = await getOrganizerCompetitionResults(id, overview.results.length);
      setOverview((current) => current
        ? { ...current, results: current.results.concat(next.results), result_offset: next.result_offset }
        : current);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal memuat peringkat berikutnya.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return <div className="p-6"><Card className="p-10 text-center text-fg-muted"><Loader2 className="mx-auto mb-2 animate-spin"/>Memuat rekap hasil…</Card></div>;
  }

  if (error || !overview) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-5 md:p-8">
        <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/>Kembali ke Control Center</Link>
        <Card className="p-8 text-center">
          <ShieldAlert size={28} className="mx-auto mb-3 text-amber-500"/>
          <h1 className="font-semibold text-fg">Rekap hasil belum dapat dibuka</h1>
          <p className="mt-2 text-sm text-fg-muted">{error || 'Data lomba tidak tersedia.'}</p>
          <Button className="mt-5" onClick={() => void load()}>Coba lagi</Button>
        </Card>
      </div>
    );
  }

  const competition = overview.competition;
  const readiness = overview.readiness;
  const results = overview.results;
  const isPublished = ['RESULT_PUBLISHED', 'ARCHIVED'].includes(competition.status);
  const isClosed = competition.status === 'SUBMISSION_CLOSED';

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/>Kembali ke Control Center</Link>
        <Button size="sm" variant="outline" loading={refreshing} onClick={() => void load(true)} icon={<RefreshCw size={14}/>}>Perbarui</Button>
      </div>

      <Card className="overflow-hidden p-5 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Penyelenggara · Tahap 3</p>
            <h1 className="mt-1 text-2xl font-bold text-fg md:text-3xl">Hasil & Publikasi</h1>
            <p className="mt-2 text-sm text-fg-muted">{competition.title}</p>
            <p className="mt-1 text-xs text-fg-muted">Jadwal pengumuman: {formatDate(competition.announcement_at)}</p>
          </div>
          <Badge color={isPublished ? 'moss' : competition.status === 'GRADING' ? 'warn' : 'default'}>{statusLabel(competition.status)}</Badge>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {isClosed && (
            <Button loading={busy} onClick={() => void beginGrading()} icon={<CheckCircle2 size={15}/>}>
              Mulai Penilaian
            </Button>
          )}
          {competition.status === 'GRADING' && (
            <Button
              loading={busy}
              disabled={!readiness.can_publish}
              onClick={() => void publish()}
              icon={<Award size={15}/>}
            >
              Terbitkan Hasil Resmi
            </Button>
          )}
          {isPublished && competition.visibility === 'PUBLIC' && (
            <Link to={'/lomba/' + encodeURIComponent(competition.slug) + '/hasil'}>
              <Button variant="outline" icon={<ExternalLink size={15}/>}>Lihat Hasil Publik</Button>
            </Link>
          )}
          {isPublished && competition.visibility !== 'PUBLIC' && (
            <span className="self-center text-xs text-fg-muted">
              Hasil resmi tersedia melalui dashboard peserta karena lomba ini bersifat privat.
            </span>
          )}
          {competition.status === 'GRADING' && !readiness.can_publish && (
            <span className="self-center text-xs text-fg-muted">
              Publikasi terkunci sampai seluruh pemeriksaan kesiapan terpenuhi.
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Peserta terdaftar" value={readiness.participant_count} icon={<Users size={18}/>}/>
        <SummaryCard label="Hasil final" value={readiness.result_count} icon={<Trophy size={18}/>}/>
        <SummaryCard label="Attempt belum selesai" value={readiness.pending_attempt_count} icon={<Clock3 size={18}/>}/>
        <SummaryCard label="Penilaian manual tertunda" value={readiness.manual_pending_count} icon={<Award size={18}/>}/>
      </div>

      {(readiness.legacy_active_count > 0 || readiness.missing_canonical_count > 0) && (
        <Card className="border border-amber-500/25 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-500"/>
            <div>
              <p className="text-sm font-semibold text-fg">Perlu pemeriksaan tambahan</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {readiness.legacy_active_count > 0 ? readiness.legacy_active_count + ' attempt aktif belum memiliki runtime ujian linear. ' : ''}
                {readiness.missing_canonical_count > 0 ? readiness.missing_canonical_count + ' attempt final belum terhubung ke identitas peserta canonical.' : ''}
                {' '}Publikasi tetap dikunci sampai data tersebut ditangani.
              </p>
            </div>
          </div>
        </Card>
      )}

      {readiness.pending_attempt_count > 0 && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-fg">Masih ada pengerjaan yang belum final</p>
            <p className="mt-1 text-xs text-fg-muted">Selesaikan atau tunggu berakhirnya sesi ujian, lalu perbarui rekap ini.</p>
          </div>
          <Link to="/organizer/grading"><Button size="sm" variant="outline">Buka Penilaian</Button></Link>
        </Card>
      )}

      {readiness.expired_attempt_count > 0 && (
        <p className="text-[11px] text-fg-muted">
          {readiness.expired_attempt_count.toLocaleString('id-ID')} attempt lama berstatus kedaluwarsa. Attempt tersebut tidak masuk peringkat karena tidak memiliki hasil FINALIZED resmi.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4 sm:p-5">
          <h2 className="font-semibold text-fg">Pratinjau Peringkat</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Urutan dan nilai dihitung dari attempt resmi terakhir yang sudah FINALIZED. Peserta dengan nilai sama berbagi peringkat.
          </p>
        </div>
        {results.length === 0 ? (
          <div className="p-10 text-center text-sm text-fg-muted">Belum ada attempt resmi yang final untuk ditampilkan.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-surface-elevated/50 text-[11px] text-fg-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Peringkat</th>
                  <th className="px-4 py-3 font-semibold">Peserta</th>
                  <th className="px-4 py-3 font-semibold">Jenjang / Sekolah</th>
                  <th className="px-4 py-3 text-right font-semibold">Skor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {results.map((row, index) => (
                  <tr key={String(row.participant_code ?? row.full_name) + '-' + index} className="text-fg-secondary">
                    <td className="px-4 py-3 font-bold tabular-nums text-fg">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-fg">{row.full_name}</p>
                      <p className="mt-0.5 text-[10px] text-fg-muted">{row.participant_type === 'COLLECTIVE' ? 'Peserta kolektif' : 'Peserta individu'}{row.participant_code ? ' · ' + row.participant_code : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">{[row.grade, row.class_name, row.school_name].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-fg">{Number(row.score).toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {overview.results.length < readiness.result_count && (
          <div className="space-y-2 border-t border-border px-4 py-4 text-center">
            <p className="text-[10px] text-fg-muted">
              Menampilkan {overview.results.length.toLocaleString('id-ID')} dari {readiness.result_count.toLocaleString('id-ID')} hasil final
            </p>
            <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
              Muat lebih banyak peringkat
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, Download, Medal, RefreshCw, Search, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { listTeacherAchievementReport, type TeacherAchievementRow } from '@/services/teacherAchievement.service';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value));
}

function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? \`'\${raw}\` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportReport(rows: TeacherAchievementRow[]) {
  const headers = ['Nama siswa', 'Kelas', 'Jenjang', 'Lomba', 'Status ujian', 'Nilai', 'Peringkat', 'Tanggal selesai', 'Status sertifikat', 'Nomor sertifikat'];
  const lines = rows.map((row) => [
    row.student_name, row.class_name, row.grade, row.competition_title, row.attempt_status,
    row.score, row.rank, row.finalized_at, row.certificate_status, row.certificate_serial_number,
  ].map(csvCell).join(','));
  const blob = new Blob(['\uFEFF', [headers.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `laporan-prestasi-sykabelajar-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: string | null) {
  if (status === 'FINALIZED') return 'Selesai';
  if (status === 'GRADING') return 'Sedang dinilai';
  if (status === 'SUBMITTED') return 'Menunggu penilaian';
  if (status === 'IN_PROGRESS') return 'Mengerjakan';
  if (status === 'EXPIRED') return 'Waktu habis';
  return 'Belum mulai';
}

export function GuruAchievementPage() {
  const [rows, setRows] = useState<TeacherAchievementRow[]>([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [competitionId, setCompetitionId] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const data = await listTeacherAchievementReport({ search: query });
      setRows(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat laporan prestasi siswa.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(''); }, [load]);

  const competitions = useMemo(() => Array.from(
    new Map(rows.map((row) => [row.competition_id, row.competition_title])).entries(),
  ), [rows]);

  const visibleRows = useMemo(() => rows.filter((row) =>
    competitionId === 'ALL' || row.competition_id === competitionId
  ), [rows, competitionId]);

  const metrics = useMemo(() => {
    const published = visibleRows.filter((row) => row.rank !== null && row.score !== null);
    const certificates = visibleRows.filter((row) => row.certificate_issued_at !== null);
    const average = published.length
      ? published.reduce((total, row) => total + Number(row.score), 0) / published.length
      : null;
    return {
      students: new Set(visibleRows.map((row) => row.roster_student_id)).size,
      competitions: new Set(visibleRows.map((row) => row.competition_id)).size,
      published: published.length,
      certificates: certificates.length,
      average,
    };
  }, [visibleRows]);

  const applySearch = () => {
    setAppliedSearch(search.trim());
    void load(search.trim());
  };

  return (
    <div className="min-h-screen surface-bg p-5 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/guru" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg">
            <ArrowLeft size={14} /> Kembali ke Workspace Guru
          </Link>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load(appliedSearch)} loading={loading} icon={<RefreshCw size={14} />}>Perbarui</Button>
            <Button size="sm" onClick={() => exportReport(visibleRows)} disabled={!visibleRows.length} icon={<Download size={14} />}>Unduh laporan</Button>
          </div>
        </div>

        <header>
          <p className="text-xs font-semibold tracking-wider text-accent">WORKSPACE GURU · LAPORAN</p>
          <h1 className="mt-1 text-2xl font-bold text-fg md:text-3xl">Prestasi & Perkembangan Siswa</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
            Pantau hasil lomba, peringkat, dan sertifikat siswa yang berada dalam pengelolaan Anda.
            Nilai dan peringkat resmi hanya ditampilkan setelah penyelenggara menerbitkan hasil.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card className="p-4"><div className="flex items-center gap-2 text-fg-muted"><Users size={16}/><span className="text-xs">Siswa terdata</span></div><p className="mt-3 text-2xl font-bold text-fg tabular-nums">{metrics.students}</p></Card>
          <Card className="p-4"><div className="flex items-center gap-2 text-fg-muted"><Trophy size={16}/><span className="text-xs">Lomba diikuti</span></div><p className="mt-3 text-2xl font-bold text-fg tabular-nums">{metrics.competitions}</p></Card>
          <Card className="p-4"><div className="flex items-center gap-2 text-fg-muted"><Medal size={16}/><span className="text-xs">Hasil terbit</span></div><p className="mt-3 text-2xl font-bold text-fg tabular-nums">{metrics.published}</p></Card>
          <Card className="p-4"><div className="flex items-center gap-2 text-fg-muted"><Award size={16}/><span className="text-xs">Sertifikat terbit</span></div><p className="mt-3 text-2xl font-bold text-fg tabular-nums">{metrics.certificates}</p></Card>
          <Card className="col-span-2 p-4 lg:col-span-1"><p className="text-xs text-fg-muted">Rata-rata nilai resmi</p><p className="mt-3 text-2xl font-bold text-fg tabular-nums">{metrics.average === null ? '—' : metrics.average.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</p><p className="mt-1 text-[10px] text-fg-muted">Dari hasil yang sudah diterbitkan</p></Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border px-3">
              <Search size={16} className="shrink-0 text-fg-muted"/>
              <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} placeholder="Cari nama, kelas, kode peserta, atau lomba" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-fg outline-none" aria-label="Cari siswa atau lomba"/>
              <Button size="sm" variant="outline" onClick={applySearch}>Cari</Button>
            </div>
            <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg" aria-label="Filter lomba">
              <option value="ALL">Semua lomba</option>
              {competitions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </div>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-semibold text-fg">Riwayat hasil siswa</h2><p className="mt-1 text-xs text-fg-muted">{visibleRows.length} catatan peserta-lomba</p></div>
            {loading && <span className="text-xs text-fg-muted">Memuat data…</span>}
          </div>
          {!loading && !visibleRows.length ? (
            <Card className="p-8 text-center"><Trophy size={28} className="mx-auto text-fg-muted"/><p className="mt-3 font-medium text-fg">Belum ada data prestasi</p><p className="mt-1 text-sm text-fg-muted">Hasil akan muncul setelah siswa yang Anda kelola mengikuti lomba. Nilai resmi menunggu publikasi penyelenggara.</p></Card>
          ) : (
            <div className="space-y-3">
              {visibleRows.map((row) => {
                const published = row.rank !== null && row.score !== null;
                return (
                  <Card key={row.collective_participant_id + row.competition_id} className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-fg">{row.student_name}</p>
                        <p className="mt-1 text-xs text-fg-muted">{row.class_name || 'Kelas belum diisi'} · {row.grade || 'Jenjang belum diisi'}</p>
                        <p className="mt-2 text-sm text-fg">{row.competition_title}</p>
                        <p className="mt-1 text-[11px] text-fg-muted">Kode peserta: {row.participant_code} · {formatDate(row.finalized_at)}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-4 md:min-w-[300px]">
                        <div><p className="text-[10px] text-fg-muted">Status</p><p className="mt-1 text-xs font-medium text-fg">{statusLabel(row.attempt_status)}</p></div>
                        <div><p className="text-[10px] text-fg-muted">Nilai</p><p className="mt-1 text-sm font-bold text-fg">{published ? Number(row.score).toLocaleString('id-ID') : '—'}</p></div>
                        <div><p className="text-[10px] text-fg-muted">Peringkat</p><p className="mt-1 text-sm font-bold text-fg">{published ? `#${row.rank}` : '—'}</p></div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="text-xs text-fg-muted">{row.certificate_issued_at ? `Sertifikat terbit · ${row.certificate_serial_number || 'Nomor belum tersedia'}` : 'Sertifikat belum diterbitkan'}</p>
                      {row.certificate_url && <a href={row.certificate_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent hover:underline">Lihat sertifikat</a>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
        <p className="text-[11px] leading-5 text-fg-muted">Laporan ini hanya mencakup peserta kolektif yang dikelola oleh akun guru ini. Simulasi penyelenggara dan percobaan tidak resmi tidak masuk ke peringkat maupun laporan prestasi.</p>
      </div>
    </div>
  );
}

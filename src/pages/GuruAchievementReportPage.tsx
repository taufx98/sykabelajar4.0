import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Download,
  FileBadge,
  Medal,
  RefreshCw,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import {
  getTeacherAchievementReport,
  type TeacherAchievementCompetition,
  type TeacherAchievementReport,
  type TeacherAchievementStudent,
} from '@/services/teacherAchievementReport.service';

const PAGE_SIZE = 50;

function formatNumber(value: number | null | undefined, maximumFractionDigits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('id-ID', { maximumFractionDigits });
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusLabel(status: string) {
  switch (status) {
    case 'FINALIZED': return 'Selesai';
    case 'IN_PROGRESS': return 'Sedang mengerjakan';
    case 'SUBMITTED': return 'Menunggu penilaian';
    case 'GRADING': return 'Sedang dinilai';
    case 'EXPIRED': return 'Waktu habis';
    case 'NOT_STARTED': return 'Belum mulai';
    default: return status || 'Belum mulai';
  }
}

function safeCertificateUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function csvCell(value: unknown) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function studentCsvRows(students: TeacherAchievementStudent[]) {
  const header = [
    'Nama siswa',
    'Kelas',
    'Jenjang',
    'Roster',
    'Total lomba',
    'Hasil diumumkan',
    'Rata-rata nilai resmi',
    'Nilai terbaik',
    'Peringkat terbaik',
    'Sertifikat terbit',
    'Penghargaan publik',
  ];
  const rows = students.map((student) => [
    student.full_name,
    student.class_name,
    student.grade,
    student.roster_name,
    student.total_competitions,
    student.published_results,
    student.average_score,
    student.best_score,
    student.best_rank,
    student.certificates_issued,
    student.public_awards,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function MetricCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">{label}</p>
        <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
          <Icon size={17} />
        </div>
      </div>
      <p className="text-2xl font-bold text-fg mt-2 tabular-nums">{value}</p>
      <p className="text-[11px] text-fg-muted mt-1">{detail}</p>
    </Card>
  );
}

function CompetitionHistory({ item }: { item: TeacherAchievementCompetition }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{item.competition_title}</p>
          <p className="text-[11px] text-fg-muted mt-1">
            {item.competition_status === 'ARCHIVED' ? 'Arsip' : item.competition_status === 'RESULT_PUBLISHED' ? 'Hasil diumumkan' : 'Status: ' + item.competition_status}
            {' · '}
            {statusLabel(item.attempt_status)}
          </p>
        </div>
        {item.result_published ? (
          <div className="flex flex-wrap gap-2">
            <Badge color="moss"><Trophy size={11} /> Peringkat #{formatNumber(item.rank)}</Badge>
            <Badge color="moss">Nilai {formatNumber(item.score, 2)}</Badge>
          </div>
        ) : (
          <span className="inline-flex rounded-lg bg-fg-muted/10 px-2.5 py-1 text-[11px] text-fg-muted">
            Hasil belum diumumkan
          </span>
        )}
      </div>
      {item.certificates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.certificates.map((certificate) => {
            const href = safeCertificateUrl(certificate.certificate_url);
            return (
              <div key={certificate.certificate_id} className="inline-flex items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs">
                <FileBadge size={14} className="text-accent" />
                <span className="text-fg">{certificate.serial_number || 'Sertifikat terbit'}</span>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                    Lihat
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StudentDetails({ student }: { student: TeacherAchievementStudent }) {
  return (
    <div className="mt-4 border-t border-border pt-4 space-y-4">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-fg">Riwayat lomba dan hasil resmi</h3>
        </div>
        {student.competitions.length ? (
          <div className="space-y-2">
            {student.competitions.map((item) => (
              <CompetitionHistory key={item.competition_id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-muted rounded-xl border border-dashed border-border p-4">
            Siswa ini belum memiliki pendaftaran lomba dari roster yang dikelola.
          </p>
        )}
      </section>
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Award size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-fg">Penghargaan publik tertaut</h3>
        </div>
        {student.awards.length ? (
          <div className="grid sm:grid-cols-2 gap-2">
            {student.awards.map((award) => (
              <div key={award.award_id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-fg">{award.title}</p>
                <p className="text-xs text-fg-muted mt-1">
                  {award.competition_title || 'Penghargaan'} · {formatDate(award.issued_at)}
                </p>
                {award.rank_code && <Badge color="moss">{award.rank_code}</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">Belum ada penghargaan publik yang tertaut pada akun siswa.</p>
        )}
      </section>
    </div>
  );
}

export function GuruAchievementReportPage() {
  const [report, setReport] = useState<TeacherAchievementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getTeacherAchievementReport({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: appliedSearch,
    })
      .then((data) => {
        if (active) {
          setReport(data);
          setExpandedStudent(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          toast.error(error instanceof Error ? error.message : 'Gagal memuat laporan prestasi.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, appliedSearch, reloadKey]);

  const summary = report?.summary;
  const totalPages = report ? Math.max(1, Math.ceil(report.total_students / PAGE_SIZE)) : 1;
  const firstItem = report && report.total_students > 0 ? report.offset + 1 : 0;
  const lastItem = report ? Math.min(report.offset + report.students.length, report.total_students) : 0;

  const exportCsv = () => {
    if (!report?.students.length) return;
    const csv = '\uFEFF' + studentCsvRows(report.students);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'laporan-prestasi-halaman-' + (page + 1) + '.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(0);
    setAppliedSearch(searchDraft.trim());
  };

  return (
    <div className="min-h-screen surface-bg p-4 md:p-7">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link to="/guru" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg">
            <ArrowLeft size={14} /> Kembali ke Guru
          </Link>
          <Button size="sm" variant="outline" loading={loading} onClick={() => setReloadKey((value) => value + 1)} icon={<RefreshCw size={14} />}>
            Refresh
          </Button>
        </div>

        <header>
          <p className="text-xs font-semibold tracking-wider text-accent">GURU · LAPORAN</p>
          <h1 className="text-2xl md:text-3xl font-bold text-fg">Laporan Prestasi Siswa</h1>
          <p className="text-sm text-fg-muted mt-1">
            Rekap perkembangan, hasil lomba resmi, sertifikat, dan penghargaan dari siswa pada roster yang kamu kelola.
          </p>
          {report?.generated_at && (
            <p className="text-[11px] text-fg-muted mt-1">
              Data diperbarui {new Date(report.generated_at).toLocaleString('id-ID')}
            </p>
          )}
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard label="Siswa terdata" value={formatNumber(summary?.students_total)} icon={Users} detail={formatNumber(summary?.active_students) + ' siswa aktif'} />
          <MetricCard label="Pendaftaran lomba" value={formatNumber(summary?.competition_entries)} icon={BookOpen} detail="Dari seluruh roster yang dikelola" />
          <MetricCard label="Hasil diumumkan" value={formatNumber(summary?.published_results)} icon={Trophy} detail="Hanya hasil resmi yang dipublikasikan" />
          <MetricCard label="Sertifikat terbit" value={formatNumber(summary?.certificates_issued)} icon={ShieldCheck} detail="Status sertifikat PUBLISHED" />
          <MetricCard label="Penghargaan publik" value={formatNumber(summary?.public_awards)} icon={Award} detail="Piagam yang dapat dilihat publik" />
        </div>

        <Card className="p-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <form onSubmit={applySearch} className="flex flex-1 gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  maxLength={120}
                  placeholder="Cari nama siswa, kelas, jenjang, atau roster…"
                  className="w-full rounded-xl border border-border bg-transparent py-2.5 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
                />
              </div>
              <Button type="submit" size="sm" loading={loading} icon={<Search size={14} />}>Cari</Button>
            </form>
            <Button
              size="sm"
              variant="outline"
              disabled={!report?.students.length}
              onClick={exportCsv}
              icon={<Download size={14} />}
            >
              Ekspor CSV
            </Button>
          </div>
          <p className="text-[11px] text-fg-muted mt-2">
            Ekspor mencakup data siswa pada halaman aktif dan filter yang sedang dipakai.
          </p>
        </Card>

        {loading && !report ? (
          <Card className="p-8 text-center text-fg-muted">Memuat laporan prestasi…</Card>
        ) : !report ? (
          <Card className="p-8 text-center space-y-3">
            <p className="text-sm text-fg-muted">Laporan belum dapat dimuat.</p>
            <Button size="sm" onClick={() => setReloadKey((value) => value + 1)}>Coba lagi</Button>
          </Card>
        ) : report.students.length === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-accent/10 text-accent flex items-center justify-center">
              <Medal size={22} />
            </div>
            <h2 className="font-semibold text-fg">Belum ada data siswa pada filter ini</h2>
            <p className="text-sm text-fg-muted">
              Tambahkan siswa ke roster melalui halaman Guru. Laporan akan terisi ketika siswa didaftarkan ke lomba.
            </p>
            <Link to="/guru" className="inline-flex justify-center">
              <Button size="sm" variant="outline">Kelola roster siswa</Button>
            </Link>
          </Card>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                Menampilkan {formatNumber(firstItem)}–{formatNumber(lastItem)} dari {formatNumber(report.total_students)} siswa
              </p>
              {report.summary.average_score != null && (
                <Badge color="moss">Rata-rata nilai resmi {formatNumber(report.summary.average_score, 2)}</Badge>
              )}
            </div>
            {report.students.map((student) => {
              const expanded = expandedStudent === student.student_id;
              return (
                <Card key={student.student_id} className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-accent/10 text-accent flex items-center justify-center shrink-0">
                      {student.photo_url ? (
                        <img src={student.photo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Users size={18} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-fg truncate">{student.full_name}</h2>
                        {student.is_active ? <Badge color="moss">Aktif</Badge> : <span className="text-[10px] text-fg-muted">Nonaktif</span>}
                      </div>
                      <p className="text-xs text-fg-muted mt-1">
                        {student.class_name || 'Kelas —'} · {student.grade || 'Jenjang —'} · {student.roster_name}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 md:w-72">
                      <div>
                        <p className="text-[10px] text-fg-muted">Lomba</p>
                        <p className="font-semibold text-fg tabular-nums">{formatNumber(student.total_competitions)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-fg-muted">Hasil resmi</p>
                        <p className="font-semibold text-fg tabular-nums">{formatNumber(student.published_results)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-fg-muted">Piagam</p>
                        <p className="font-semibold text-fg tabular-nums">{formatNumber(student.certificates_issued + student.public_awards)}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setExpandedStudent(expanded ? null : student.student_id)}>
                      {expanded ? 'Tutup' : 'Lihat detail'}
                    </Button>
                  </div>
                  {expanded && <StudentDetails student={student} />}
                </Card>
              );
            })}
            <div className="flex items-center justify-between gap-3 pt-2">
              <Button size="sm" variant="outline" disabled={page <= 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                Sebelumnya
              </Button>
              <p className="text-xs text-fg-muted tabular-nums">Halaman {page + 1} dari {totalPages}</p>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>
                Berikutnya
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

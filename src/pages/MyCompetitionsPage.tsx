import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Award,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileCheck,
  GraduationCap,
  LayoutGrid,
  List,
  Play,
  Search,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useApp } from '@/store/AppContext';
import {
  listMyCompetitionDashboard,
  type ParticipantDashboardItem,
} from '@/services/participant.service';
import {
  listMyCanonicalCertificates,
  type CanonicalParticipantCertificate,
} from '@/services/certificate.service';

type DashboardStatus =
  | 'pending'
  | 'rejected'
  | 'cancelled'
  | 'registered'
  | 'in_progress'
  | 'waiting_result'
  | 'result_published';

type DashboardFilter =
  | 'all'
  | 'registration'
  | 'in_progress'
  | 'waiting_result'
  | 'result_published'
  | 'cancelled';

type ViewMode = 'grid' | 'list';
type CertificateFilter = 'all' | 'winner' | 'participation';

type AgendaEvent = {
  id: string;
  competitionId: string;
  competitionSlug: string;
  competitionTitle: string;
  label: string;
  date: string;
};

const FILTERS: Array<{ id: DashboardFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'registration', label: 'Pendaftaran' },
  { id: 'in_progress', label: 'Sedang Berlangsung' },
  { id: 'waiting_result', label: 'Menunggu Hasil' },
  { id: 'result_published', label: 'Hasil Diumumkan' },
  { id: 'cancelled', label: 'Dibatalkan' },
];

const STATUS_META: Record<DashboardStatus, { label: string; className: string }> = {
  pending: {
    label: 'Menunggu Persetujuan',
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-500',
  },
  rejected: {
    label: 'Pendaftaran Ditolak',
    className: 'border-rose-500/25 bg-rose-500/10 text-rose-500',
  },
  cancelled: {
    label: 'Dibatalkan',
    className: 'border-slate-500/25 bg-slate-500/10 text-slate-400',
  },
  registered: {
    label: 'Terdaftar',
    className: 'border-sky-500/25 bg-sky-500/10 text-sky-500',
  },
  in_progress: {
    label: 'Sedang Berlangsung',
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
  },
  waiting_result: {
    label: 'Menunggu Hasil',
    className: 'border-violet-500/25 bg-violet-500/10 text-violet-500',
  },
  result_published: {
    label: 'Hasil Diumumkan',
    className: 'border-blue-500/25 bg-blue-500/10 text-blue-500',
  },
};

const REGISTRATION_FILTER_STATUSES: DashboardStatus[] = ['pending', 'rejected', 'registered'];

const AGENDA_MILESTONES: Array<{
  field: 'registration_starts_at' | 'registration_ends_at' | 'starts_at' | 'ends_at' | 'announcement_at';
  label: string;
}> = [
  { field: 'registration_starts_at', label: 'Pendaftaran dibuka' },
  { field: 'registration_ends_at', label: 'Pendaftaran ditutup' },
  { field: 'starts_at', label: 'Pelaksanaan dimulai' },
  { field: 'ends_at', label: 'Pelaksanaan selesai' },
  { field: 'announcement_at', label: 'Pengumuman hasil' },
];

function classifyItem(item: ParticipantDashboardItem): DashboardStatus {
  const registrationStatus = String(item.registration?.status ?? '').toUpperCase();
  const competitionStatus = String(item.competition.status ?? '').toUpperCase();
  const attemptStatus = String(item.latest_attempt?.status ?? '').toUpperCase();
  const hasParticipant = Boolean(item.participant?.id);

  if (competitionStatus === 'CANCELLED') return 'cancelled';
  if (!hasParticipant && registrationStatus === 'PENDING') return 'pending';
  if (!hasParticipant && registrationStatus === 'REJECTED') return 'rejected';
  if (!hasParticipant && registrationStatus === 'CANCELLED') return 'cancelled';
  if (item.result?.published) return 'result_published';

  if (['IN_PROGRESS', 'RUNNING'].includes(attemptStatus)) return 'in_progress';
  if (
    ['SUBMITTED', 'GRADING', 'EXPIRED'].includes(attemptStatus)
    || (attemptStatus === 'FINALIZED' && ['SUBMISSION_CLOSED', 'GRADING'].includes(competitionStatus))
    || ['SUBMISSION_CLOSED', 'GRADING'].includes(competitionStatus)
  ) return 'waiting_result';

  if (competitionStatus === 'LIVE' && hasParticipant) return 'in_progress';
  return 'registered';
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Jadwal belum ditentukan';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Jadwal belum ditentukan';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(date) + ' WIB';
}

function competitionDate(item: ParticipantDashboardItem) {
  const start = formatDate(item.competition.starts_at);
  const end = formatDate(item.competition.ends_at);
  if (start && end && start !== end) return start + ' – ' + end;
  if (start) return start;
  const deadline = formatDate(item.competition.registration_ends_at);
  return deadline ? 'Pendaftaran hingga ' + deadline : 'Jadwal belum ditentukan';
}

function buildAgendaEvents(items: ParticipantDashboardItem[], now = Date.now()): AgendaEvent[] {
  return items.flatMap((item) => AGENDA_MILESTONES.flatMap((milestone) => {
    const value = item.competition[milestone.field];
    if (!value) return [];
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp) || timestamp < now) return [];
    return [{
      id: item.entry_id + '-' + milestone.field,
      competitionId: item.competition.id,
      competitionSlug: item.competition.slug,
      competitionTitle: item.competition.title,
      label: milestone.label,
      date: value,
    }];
  })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function statusDescription(item: ParticipantDashboardItem, status: DashboardStatus) {
  if (status === 'pending') {
    return 'Pendaftaran sudah dikirim dan sedang menunggu pemeriksaan penyelenggara.';
  }
  if (status === 'rejected') {
    return item.registration?.rejection_reason
      || 'Pendaftaran belum disetujui. Buka detail lomba untuk informasi lebih lanjut.';
  }
  if (status === 'cancelled') {
    return String(item.competition.status).toUpperCase() === 'CANCELLED'
      ? 'Lomba ini telah dibatalkan oleh penyelenggara.'
      : 'Pendaftaran ini sudah dibatalkan.';
  }
  if (status === 'result_published') return 'Hasil resmi lomba sudah dapat dilihat.';
  if (status === 'waiting_result') {
    return String(item.latest_attempt?.status ?? '').toUpperCase() === 'FINALIZED'
      ? 'Pengerjaan sudah selesai. Nilai dan peringkat tampil setelah pengumuman resmi.'
      : 'Jawaban sedang diproses atau dinilai oleh penyelenggara.';
  }
  if (status === 'in_progress') {
    return String(item.latest_attempt?.status ?? '').toUpperCase() === 'IN_PROGRESS'
      ? 'Kamu memiliki pengerjaan yang dapat dilanjutkan.'
      : 'Sesi lomba sedang berlangsung. Pastikan kamu siap sebelum masuk ruang ujian.';
  }
  return String(item.registration?.status ?? '').toUpperCase() === 'APPROVED'
    ? 'Pendaftaranmu sudah disetujui. Pantau jadwal dan informasi pelaksanaan lomba.'
    : 'Pendaftaranmu tercatat. Pantau jadwal dan informasi lomba di halaman detail.';
}

function registrationStatusLabel(value: string | null | undefined) {
  const status = String(value ?? '').toUpperCase();
  if (status === 'PENDING') return 'Menunggu persetujuan';
  if (status === 'APPROVED' || status === 'ACTIVE') return 'Disetujui';
  if (status === 'REJECTED') return 'Ditolak';
  if (status === 'CANCELLED') return 'Dibatalkan';
  return status ? status.replaceAll('_', ' ') : 'Belum ada data pendaftaran';
}

function attemptStatusLabel(value: string | null | undefined) {
  const status = String(value ?? '').toUpperCase();
  if (status === 'IN_PROGRESS' || status === 'RUNNING') return 'Sedang dikerjakan';
  if (status === 'SUBMITTED') return 'Jawaban terkirim';
  if (status === 'GRADING') return 'Sedang dinilai';
  if (status === 'FINALIZED') return 'Pengerjaan selesai';
  if (status === 'EXPIRED') return 'Waktu pengerjaan berakhir';
  return status ? status.replaceAll('_', ' ') : 'Belum ada pengerjaan';
}

function canEnterExam(item: ParticipantDashboardItem) {
  const attemptStatus = String(item.latest_attempt?.status ?? '').toUpperCase();
  return item.participant_type === 'INDIVIDUAL'
    && Boolean(item.participant?.id)
    && (String(item.competition.status).toUpperCase() === 'LIVE' || attemptStatus === 'IN_PROGRESS');
}

function examHref(item: ParticipantDashboardItem) {
  return '/lomba/' + encodeURIComponent(item.competition.slug) + '/kerja';
}

function resultHref(item: ParticipantDashboardItem) {
  return '/lomba/' + encodeURIComponent(item.competition.slug) + '/hasil';
}

function detailHref(item: ParticipantDashboardItem) {
  return '/lomba/' + encodeURIComponent(item.competition.slug);
}

function certificateTypeLabel(value: string) {
  const type = value.toUpperCase();
  if (/WIN|JUARA|FINALIST|ACHIEVEMENT|AWARD/.test(type)) return 'Penghargaan';
  if (/PARTICIP/.test(type)) return 'Partisipasi';
  return value.replaceAll('_', ' ') || 'Sertifikat';
}

function safeDocumentUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function SummaryCard({
  label,
  value,
  icon,
  tone = 'default',
  footnote,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'blue' | 'violet' | 'green';
  footnote?: string;
}) {
  const tones = {
    default: 'bg-indigo-500/10 text-indigo-300 border-indigo-400/20',
    blue: 'bg-blue-500/10 text-blue-300 border-blue-400/20',
    violet: 'bg-violet-500/10 text-violet-300 border-violet-400/20',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20',
  };
  return (
    <Card className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/90 p-3 shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900 sm:p-4 lg:p-5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-[10px] font-semibold leading-snug text-slate-400 sm:text-xs sm:leading-relaxed">{label}</span>
        <span className={'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border sm:h-10 sm:w-10 sm:rounded-xl [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-[18px] sm:[&>svg]:w-[18px] ' + tones[tone]}>{icon}</span>
      </div>
      <div className="mt-2 flex min-w-0 items-end justify-between gap-1.5 sm:gap-2">
        <strong className="shrink-0 text-2xl font-extrabold leading-none tracking-tight tabular-nums text-slate-100 sm:text-3xl">{value.toLocaleString('id-ID')}</strong>
        {footnote && <span className="line-clamp-2 min-w-0 max-w-[58%] text-right text-[9px] font-semibold leading-tight text-slate-400 sm:max-w-none sm:text-[10px]">{footnote}</span>}
      </div>
      <div className="mt-3 h-px bg-gradient-to-r from-accent/55 to-transparent sm:mt-4" />
    </Card>
  );
}

function CompetitionStageTracker({ status }: { status: DashboardStatus }) {
  if (status === 'cancelled') return null;
  const stage = status === 'result_published'
    ? 3
    : status === 'waiting_result'
      ? 2
      : status === 'in_progress'
        ? 1
        : 0;
  const stages = ['Pendaftaran', 'Pelaksanaan', 'Penilaian', 'Hasil'];
  return (
    <div className="mt-2 rounded-xl border border-slate-800/70 bg-slate-800/35 px-2.5 py-2 sm:mt-4 sm:px-3 sm:py-3">
      <div className="flex items-center justify-between gap-0.5 sm:gap-1">
        {stages.map((label, index) => (
          <div key={label} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-1.5">
              <span className={'flex h-4 w-4 items-center justify-center rounded-full border text-[8px] font-bold sm:h-5 sm:w-5 sm:text-[9px] ' + (index <= stage
                ? 'border-accent bg-accent text-white'
                : 'border-slate-800 bg-slate-950 text-slate-400')}>
                {index < stage ? <CheckCircle2 size={10} /> : index + 1}
              </span>
              <span className={'max-w-full text-center text-[8px] font-semibold leading-tight sm:text-[9px] ' + (index === stage ? 'text-accent' : 'text-slate-400')}>{label}</span>
            </div>
            {index < stages.length - 1 && (
              <span className={'mx-0.5 mb-4 h-px min-w-1 flex-1 sm:mx-1 sm:mb-5 ' + (index < stage ? 'bg-accent/70' : 'bg-slate-700')} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitionCard({
  item,
  viewMode,
  onOpenDetails,
  onOpenCertificates,
}: {
  item: ParticipantDashboardItem;
  viewMode: ViewMode;
  onOpenDetails: (item: ParticipantDashboardItem) => void;
  onOpenCertificates: (competitionId: string) => void;
}) {
  const status = classifyItem(item);
  const meta = STATUS_META[status];
  const competition = item.competition;
  const isCollective = item.participant_type === 'COLLECTIVE';
  const examAvailable = canEnterExam(item);
  const cardLayout = viewMode === 'list' ? 'flex-row' : 'flex-col';
  const cardContent = 'p-3 sm:p-4 lg:p-5';

  return (
    <Card className={'group flex h-full min-w-0 overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/90 shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900 ' + cardLayout}>
      {viewMode === 'grid' ? (
        <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-slate-800 sm:aspect-[16/8] lg:aspect-auto lg:h-40">
          {competition.poster_url ? (
            <img
              src={competition.poster_url}
              alt={'Poster ' + competition.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500/15 via-slate-800 to-slate-900 text-indigo-300/70">
              <Trophy size={40} strokeWidth={1.4} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/5" />
          <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1 sm:left-3 sm:top-3 sm:max-w-[calc(100%-1.5rem)] sm:gap-1.5">
            <span className={'rounded-full border px-2 py-0.5 text-[8px] font-extrabold shadow-sm backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-[9px] ' + meta.className}>{meta.label}</span>
            <span className="rounded-full border border-white/10 bg-slate-950/75 px-2 py-0.5 text-[8px] font-bold text-white backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-[9px]">
              {isCollective ? 'Peserta Kolektif' : 'Peserta Individu'}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-center p-4 sm:p-5">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300">
            <Trophy size={24} strokeWidth={1.6} />
          </span>
        </div>
      )}

      <div className={'flex min-w-0 flex-1 flex-col ' + cardContent}>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {viewMode === 'list' && (
            <span className={'rounded-full border px-2 py-0.5 text-[8px] font-bold sm:px-2.5 sm:py-1 sm:text-[9px] ' + meta.className}>{meta.label}</span>
          )}
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-700/70 bg-slate-800/50 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-indigo-300 sm:px-2 sm:py-1 sm:text-[9px]">
            {competition.category || 'Kompetisi'}
          </span>
          {viewMode === 'list' && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-400">
              {isCollective ? <Users size={11} /> : <GraduationCap size={11} />}
              {isCollective ? 'Peserta kolektif' : 'Peserta individu'}
            </span>
          )}
        </div>

        <h2 className="mt-1.5 line-clamp-2 text-xs font-extrabold leading-snug text-slate-100 sm:mt-2 sm:text-sm lg:text-base">{competition.title}</h2>
        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-slate-400 sm:mt-2 sm:text-[11px] sm:leading-relaxed">
          <CalendarDays size={12} className="mt-0.5 shrink-0 text-accent sm:h-[13px] sm:w-[13px]" />
          <span>{competitionDate(item)}</span>
        </p>
        {item.participant?.full_name && (
          <p className="mt-1 flex items-center gap-1.5 truncate text-[9px] text-slate-400 sm:text-[10px]">
            <Users size={12} className="shrink-0" />
            <span className="truncate">{item.participant.full_name}</span>
            {item.participant.grade && <span className="shrink-0">· {item.participant.grade}</span>}
          </p>
        )}

        <p className="mt-2 line-clamp-3 min-h-0 text-[10px] leading-snug text-slate-400 sm:mt-3 sm:line-clamp-none sm:min-h-10 sm:text-[11px] sm:leading-relaxed">{statusDescription(item, status)}</p>
        {status === 'rejected' && item.registration?.rejection_reason && (
          <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-[9px] leading-relaxed text-rose-500 sm:p-2.5 sm:text-[10px]">
            Alasan: {item.registration.rejection_reason}
          </div>
        )}

        {status === 'result_published' && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-800/55 p-2 sm:p-3">
              <span className="block text-[9px] font-semibold text-slate-400">Skor akhir</span>
              <strong className="mt-1 block text-lg font-extrabold tabular-nums text-slate-100 sm:text-xl">
                {item.result.score == null ? '—' : Number(item.result.score).toLocaleString('id-ID')}
              </strong>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-800/55 p-2 sm:p-3">
              <span className="block text-[9px] font-semibold text-slate-400">Peringkat</span>
              <strong className="mt-1 block text-lg font-extrabold tabular-nums text-slate-100 sm:text-xl">
                {item.result.rank == null ? '—' : '#' + Number(item.result.rank).toLocaleString('id-ID')}
              </strong>
            </div>
          </div>
        )}

        {status !== 'cancelled' && <CompetitionStageTracker status={status} />}

        <div className="mt-auto flex flex-col items-start gap-2 border-t border-slate-800/70 pt-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pt-3">
          <span className="text-[9px] font-medium leading-tight text-slate-400 sm:text-[10px]">
            {item.published_certificate_count > 0
              ? item.published_certificate_count + ' piagam terbit'
              : item.certificate_count > 0
                ? item.certificate_count + ' piagam dalam proses'
                : 'Piagam belum tersedia'}
          </span>
          <div className="flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:justify-end sm:gap-2">
            {item.published_certificate_count > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="px-2 py-1.5 text-[9px] sm:px-2.5 sm:py-2 sm:text-[10px]"
                onClick={() => onOpenCertificates(competition.id)}
                icon={<Award size={13} />}
              >
                Piagam
              </Button>
            )}
            {status === 'result_published' && (
              <Link to={resultHref(item)} className="btn-outline px-2 py-1.5 text-[9px] sm:px-3 sm:py-2 sm:text-[10px]">
                Lihat Hasil
              </Link>
            )}
            {isCollective ? (
              <Link to="/profile/collective-history" className="btn-primary px-2 py-1.5 text-[9px] sm:px-3 sm:py-2 sm:text-[10px]">
                Riwayat <ChevronRight size={13} />
              </Link>
            ) : examAvailable ? (
              <Link to={examHref(item)} className="btn-primary px-2 py-1.5 text-[9px] sm:px-3 sm:py-2 sm:text-[10px]">
                {String(item.latest_attempt?.status ?? '').toUpperCase() === 'IN_PROGRESS' ? 'Lanjutkan Ujian' : 'Masuk Ujian'}
                <Play size={12} fill="currentColor" />
              </Link>
            ) : (
              <Button size="sm" className="px-2 py-1.5 text-[9px] sm:px-3 sm:py-2 sm:text-[10px]" onClick={() => onOpenDetails(item)} icon={<ChevronRight size={13} />}>
                Detail Lomba
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AgendaModal({
  open,
  onClose,
  events,
}: {
  open: boolean;
  onClose: () => void;
  events: AgendaEvent[];
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agenda & Timeline Lomba"
      size="lg"
      footer={<Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>}
    >
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Jadwal berikut diambil dari tanggal pendaftaran, pelaksanaan, dan pengumuman pada lomba yang kamu ikuti.
      </p>
      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-5 py-10 text-center">
          <CalendarDays size={30} className="mx-auto text-slate-400" />
          <p className="mt-3 text-sm font-semibold text-slate-100">Belum ada agenda terdekat</p>
          <p className="mt-1 text-xs text-slate-400">Jadwal berikutnya akan muncul setelah penyelenggara menetapkan tanggal penting lomba.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-800/45 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-indigo-500/10 text-indigo-300">
                <CalendarClock size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-accent">{event.label}</p>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-100">{event.competitionTitle}</p>
                <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(event.date)}</p>
              </div>
              <Link
                to={'/lomba/' + encodeURIComponent(event.competitionSlug)}
                onClick={onClose}
                aria-label={'Buka detail ' + event.competitionTitle}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 text-slate-400 transition hover:border-accent/40 hover:text-accent"
              >
                <ChevronRight size={15} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function CompetitionDetailModal({
  item,
  onClose,
  onOpenCertificates,
}: {
  item: ParticipantDashboardItem | null;
  onClose: () => void;
  onOpenCertificates: (competitionId: string) => void;
}) {
  if (!item) return null;
  const status = classifyItem(item);
  const isCollective = item.participant_type === 'COLLECTIVE';
  const examAvailable = canEnterExam(item);
  const schedule = [
    ['Pendaftaran dibuka', item.competition.registration_starts_at],
    ['Pendaftaran ditutup', item.competition.registration_ends_at],
    ['Pelaksanaan dimulai', item.competition.starts_at],
    ['Pelaksanaan selesai', item.competition.ends_at],
    ['Pengumuman hasil', item.competition.announcement_at],
  ] as Array<[string, string | null]>;

  return (
    <Modal
      open
      onClose={onClose}
      title="Detail Keikutsertaan"
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
          <div className="flex flex-wrap gap-2">
            {item.published_certificate_count > 0 && (
              <Button size="sm" variant="outline" onClick={() => { onClose(); onOpenCertificates(item.competition.id); }} icon={<Award size={14} />}>
                Piagam
              </Button>
            )}
            {item.result?.published && (
              <Link to={resultHref(item)} onClick={onClose} className="btn-outline text-xs">
                Lihat hasil resmi
              </Link>
            )}
            {isCollective ? (
              <Link to="/profile/collective-history" onClick={onClose} className="btn-primary text-xs">
                Riwayat kolektif <ChevronRight size={14} />
              </Link>
            ) : examAvailable ? (
              <Link to={examHref(item)} onClick={onClose} className="btn-primary text-xs">
                {String(item.latest_attempt?.status ?? '').toUpperCase() === 'IN_PROGRESS' ? 'Lanjutkan ujian' : 'Masuk ujian'}
                <Play size={13} />
              </Link>
            ) : (
              <Link to={detailHref(item)} onClick={onClose} className="btn-primary text-xs">
                Buka detail lomba <ExternalLink size={13} />
              </Link>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="relative isolate min-h-[190px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          {item.competition.poster_url && (
            <img
              src={item.competition.poster_url}
              alt={'Poster ' + item.competition.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-indigo-950/55" />
          <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className={'rounded-full border px-2.5 py-1 text-[10px] font-bold ' + STATUS_META[status].className}>{STATUS_META[status].label}</span>
              <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                {isCollective ? 'Peserta kolektif' : 'Peserta individu'}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-extrabold leading-snug text-slate-100 sm:text-xl">{item.competition.title}</h2>
            <p className="mt-1 text-xs text-accent">{item.competition.category || 'Kompetisi'}</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">{statusDescription(item, status)}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-3.5">
            <p className="text-[10px] font-semibold text-slate-400">Identitas peserta</p>
            <p className="mt-1 text-sm font-bold text-slate-100">{item.participant?.full_name || 'Menunggu data peserta'}</p>
            <p className="mt-1 text-[10px] text-slate-400">
              {[item.participant?.grade, item.participant?.class_name, item.participant?.participant_code].filter(Boolean).join(' · ') || (isCollective ? 'Riwayat peserta kolektif yang telah diklaim' : 'Peserta individu')}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-3.5">
            <p className="text-[10px] font-semibold text-slate-400">Status pendaftaran</p>
            <p className="mt-1 text-sm font-bold text-slate-100">{registrationStatusLabel(item.registration?.status)}</p>
            {item.registration?.submitted_at && <p className="mt-1 text-[10px] text-slate-400">Dikirim {formatDateTime(item.registration.submitted_at)}</p>}
            {item.registration?.rejection_reason && <p className="mt-2 text-[10px] leading-relaxed text-rose-500">Alasan: {item.registration.rejection_reason}</p>}
          </div>
        </div>

        <section className="rounded-xl border border-slate-800 p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays size={15} className="text-accent" />
            <h3 className="text-xs font-bold text-slate-100">Jadwal kompetisi</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {schedule.map(([label, date]) => (
              <div key={label} className="rounded-lg bg-slate-800/50 px-3 py-2.5">
                <p className="text-[9px] font-semibold text-slate-400">{label}</p>
                <p className="mt-1 text-[11px] font-bold text-slate-100">{formatDateTime(date)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 p-3.5">
          <div className="mb-2 flex items-center gap-2">
            <FileCheck size={15} className="text-accent" />
            <h3 className="text-xs font-bold text-slate-100">Aktivitas pengerjaan</h3>
          </div>
          <p className="text-xs font-semibold text-slate-100">{attemptStatusLabel(item.latest_attempt?.status)}</p>
          {item.latest_attempt?.attempt_number != null && (
            <p className="mt-1 text-[10px] text-slate-400">Pengerjaan ke-{item.latest_attempt.attempt_number}</p>
          )}
          {item.latest_attempt?.started_at && (
            <p className="mt-1 text-[10px] text-slate-400">Dimulai {formatDateTime(item.latest_attempt.started_at)}</p>
          )}
          {item.latest_attempt?.submitted_at && (
            <p className="mt-1 text-[10px] text-slate-400">Dikirim {formatDateTime(item.latest_attempt.submitted_at)}</p>
          )}
        </section>

        {item.result?.published && (
          <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-500" />
              <h3 className="text-xs font-bold text-slate-100">Hasil resmi</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-[9px] text-slate-400">Skor akhir</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-100">{item.result.score == null ? '—' : Number(item.result.score).toLocaleString('id-ID')}</p>
              </div>
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-[9px] text-slate-400">Peringkat</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-100">{item.result.rank == null ? '—' : '#' + Number(item.result.rank).toLocaleString('id-ID')}</p>
              </div>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-800/35 px-3.5 py-3">
          <span className="text-[10px] text-slate-400">
            {item.published_certificate_count > 0
              ? item.published_certificate_count + ' piagam telah diterbitkan'
              : item.certificate_count > 0
                ? item.certificate_count + ' piagam sedang diproses'
                : 'Belum ada piagam pada keikutsertaan ini'}
          </span>
          {item.published_certificate_count > 0 && (
            <button type="button" onClick={() => { onClose(); onOpenCertificates(item.competition.id); }} className="text-[10px] font-bold text-accent hover:underline">
              Lihat riwayat piagam
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CertificateHistoryModal({
  open,
  onClose,
  userId,
  items,
  competitionFilter,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  items: ParticipantDashboardItem[];
  competitionFilter: string | null;
}) {
  const { toast } = useApp();
  const [rows, setRows] = useState<CanonicalParticipantCertificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CertificateFilter>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setFilter('all');
    }
  }, [open, competitionFilter]);

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    setLoading(true);
    setError('');
    void listMyCanonicalCertificates()
      .then((certificates) => { if (active) setRows(certificates); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Riwayat sertifikat gagal dimuat.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, userId, refreshKey]);

  const titleByCompetition = useMemo(() => {
    const titles = new Map<string, string>();
    for (const item of items) titles.set(item.competition.id, item.competition.title);
    return titles;
  }, [items]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
    return rows.filter((certificate) => {
      if (competitionFilter && certificate.competition_id !== competitionFilter) return false;
      const type = String(certificate.certificate_type ?? '').toUpperCase();
      if (filter === 'winner' && !/WIN|JUARA|FINALIST|ACHIEVEMENT|AWARD/.test(type)) return false;
      if (filter === 'participation' && !/PARTICIP/.test(type)) return false;
      const title = titleByCompetition.get(certificate.competition_id) || 'Sertifikat lomba';
      const searchText = [
        title,
        certificate.serial_number,
        certificate.certificate_type,
        certificate.full_name,
      ].filter(Boolean).join(' ').toLocaleLowerCase('id-ID');
      return !normalizedQuery || searchText.includes(normalizedQuery);
    });
  }, [rows, query, filter, titleByCompetition, competitionFilter]);

  const copySerial = async (serial: string) => {
    try {
      await navigator.clipboard.writeText(serial);
      toast('Nomor sertifikat berhasil disalin.', 'success');
    } catch {
      toast('Nomor sertifikat tidak dapat disalin dari browser ini.', 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Riwayat Sertifikat & Piagam"
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[10px] text-slate-400">Menampilkan {visibleRows.length.toLocaleString('id-ID')} dari {rows.length.toLocaleString('id-ID')} dokumen</span>
          <Button size="sm" variant="outline" onClick={onClose}>Tutup</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-slate-700/55 bg-slate-800/35 p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-indigo-500/10 text-indigo-300"><Award size={17} /></span>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Dokumen diambil dari riwayat sertifikat peserta yang terhubung dengan akunmu. Tautan dokumen hanya ditampilkan ketika URL sertifikat tersedia dari sistem.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari lomba atau nomor sertifikat..."
              aria-label="Cari riwayat sertifikat"
              className="input w-full pl-9 text-xs"
            />
          </label>
          <div className="flex gap-1.5 overflow-x-auto">
            {([
              { id: 'all', label: 'Semua' },
              { id: 'winner', label: 'Juara & Penghargaan' },
              { id: 'participation', label: 'Partisipasi' },
            ] as Array<{ id: CertificateFilter; label: string }>).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                className={'shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold transition ' + (filter === tab.id
                  ? 'bg-accent text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-100')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((value) => <div key={value} className="h-24 animate-pulse rounded-xl bg-slate-800" />)}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 text-center">
            <AlertCircle size={23} className="mx-auto text-rose-500" />
            <p className="mt-2 text-sm font-semibold text-slate-100">Riwayat sertifikat belum dapat dimuat</p>
            <p className="mt-1 break-words text-xs text-slate-400">{error}</p>
            <Button size="sm" className="mt-3" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>Coba lagi</Button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 px-5 py-10 text-center">
            <FileCheck size={28} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-100">{rows.length === 0 ? 'Belum ada sertifikat terbit' : 'Sertifikat tidak ditemukan'}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {rows.length === 0
                ? 'Sertifikat yang diterbitkan untuk keikutsertaanmu akan muncul di sini.'
                : 'Coba kata kunci atau filter yang berbeda.'}
            </p>
            {rows.length > 0 && <Button size="sm" variant="outline" className="mt-3" onClick={() => { setQuery(''); setFilter('all'); }}>Hapus filter</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRows.map((certificate) => {
              const title = titleByCompetition.get(certificate.competition_id) || 'Sertifikat lomba';
              const status = String(certificate.status ?? '').toUpperCase();
              const published = status === 'PUBLISHED' || status === 'VERIFIED';
              const documentUrl = published ? safeDocumentUrl(certificate.certificate_url) : null;
              return (
                <div key={certificate.certificate_id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/35 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/15 bg-amber-500/10 text-amber-500">
                      <Trophy size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-slate-700/70 bg-slate-800/50 px-2 py-0.5 text-[9px] font-bold text-indigo-300">{certificateTypeLabel(certificate.certificate_type)}</span>
                        <span className={'rounded-md px-2 py-0.5 text-[9px] font-bold ' + (published ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500')}>
                          {published ? 'Diterbitkan' : status ? status.replaceAll('_', ' ') : 'Dalam proses'}
                        </span>
                      </div>
                      <h3 className="mt-1.5 line-clamp-2 text-xs font-bold text-slate-100">{title}</h3>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {certificate.serial_number ? 'No. seri: ' + certificate.serial_number : 'Nomor seri belum tersedia'}
                        {certificate.issued_at ? ' · ' + (formatDate(certificate.issued_at) || '') : ''}
                      </p>
                      {certificate.full_name && <p className="mt-0.5 truncate text-[10px] text-slate-400">Atas nama {certificate.full_name}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-slate-800/70 pt-2 sm:border-0 sm:pt-0">
                    {certificate.serial_number && (
                      <Button size="sm" variant="outline" className="px-2.5" onClick={() => void copySerial(certificate.serial_number as string)} title="Salin nomor sertifikat">
                        <ClipboardList size={13} />
                      </Button>
                    )}
                    {documentUrl ? (
                      <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="btn-primary px-3 py-2 text-[10px]">
                        Lihat dokumen <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-[10px] font-semibold text-slate-400">
                        {published ? 'Dokumen belum tersedia' : 'Menunggu penerbitan'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MyCompetitionsPage() {
  const { user, isGuest } = useApp();
  const [items, setItems] = useState<ParticipantDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ParticipantDashboardItem | null>(null);
  const [certificatesOpen, setCertificatesOpen] = useState(false);
  const [certificateCompetitionFilter, setCertificateCompetitionFilter] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);

  useEffect(() => {
    if (!user || isGuest) {
      setItems([]);
      setSyncedAt(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void listMyCompetitionDashboard()
      .then((rows) => {
        if (!active) return;
        setItems(rows);
        setSyncedAt(new Date().toISOString());
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Gagal memuat daftar lomba.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, isGuest, refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const counts = useMemo(() => {
    const statuses = items.map(classifyItem);
    return {
      all: items.length,
      registration: statuses.filter((status) => REGISTRATION_FILTER_STATUSES.includes(status)).length,
      in_progress: statuses.filter((status) => status === 'in_progress').length,
      waiting_result: statuses.filter((status) => status === 'waiting_result').length,
      result_published: statuses.filter((status) => status === 'result_published').length,
      cancelled: statuses.filter((status) => status === 'cancelled').length,
    } satisfies Record<DashboardFilter, number>;
  }, [items]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
    return items.filter((item) => {
      const status = classifyItem(item);
      const matchesFilter = filter === 'all'
        || (filter === 'registration' && REGISTRATION_FILTER_STATUSES.includes(status))
        || status === filter;
      const searchText = [
        item.competition.title,
        item.competition.category,
        item.participant?.full_name,
        item.participant?.participant_code,
        item.participant_type,
      ].filter(Boolean).join(' ').toLocaleLowerCase('id-ID');
      return matchesFilter && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [items, filter, query]);

  const agendaEvents = useMemo(() => buildAgendaEvents(items, clock), [items, clock]);

  const activeExamItem = useMemo(() => items
    .filter((item) => canEnterExam(item) && classifyItem(item) === 'in_progress')
    .sort((a, b) => {
      const aDate = a.competition.starts_at ? new Date(a.competition.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.competition.starts_at ? new Date(b.competition.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    })[0] ?? null, [items]);

  const activeFilterIndex = Math.max(0, FILTERS.findIndex((tab) => tab.id === filter));
  const stepFilter = (direction: -1 | 1) => {
    const nextFilter = FILTERS[activeFilterIndex + direction];
    if (nextFilter) setFilter(nextFilter.id);
  };

  const openCertificates = (competitionId: string | null = null) => {
    setCertificateCompetitionFilter(competitionId);
    setCertificatesOpen(true);
  };

  if (isGuest || !user) {
    return (
      <div className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center px-4 py-10">
        <Card className="w-full p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><ClipboardList size={26} /></span>
          <h1 className="mt-4 text-xl font-bold text-slate-100">Lomba Saya</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">Masuk ke akun SykaBelajar untuk melihat pendaftaran, pengerjaan, hasil, dan piagam lombamu.</p>
          <Link to="/login?redirect=%2Flomba-saya" className="mt-5 inline-flex"><Button>Masuk ke akun</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <main className="my-competitions-page min-h-screen bg-[#070B14] px-3 py-4 pb-24 text-slate-300 sm:px-6 sm:py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-5 sm:space-y-6 lg:space-y-8">
        <Card className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/60 p-4 shadow-2xl shadow-black/20 sm:p-6 md:p-7">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-indigo-500/5 to-blue-500/15" />
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-blue-500/15 blur-3xl" />

          <div className="relative z-10">
            <div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
                    <Sparkles size={12} /> Portal Peserta Resmi
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {syncedAt ? 'Terakhir disinkronkan ' + formatDateTime(syncedAt) : 'Data keikutsertaan akunmu'}
                  </span>
                </div>
                <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-100 sm:text-3xl md:text-4xl">Lomba Saya</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
                  Kelola keikutsertaan kompetisi, pantau jadwal dan pengerjaan, periksa hasil resmi, serta akses piagam yang diterbitkan untuk akunmu.
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Link to="/home" className="btn-primary px-3 py-2 text-xs">
                  <Sparkles size={14} /> Jelajahi Lomba Baru
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openCertificates()}
                  icon={<Award size={14} />}
                >
                  Riwayat Sertifikat
                  <span className="ml-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
                    {items.reduce((sum, item) => sum + item.published_certificate_count, 0).toLocaleString('id-ID')}
                  </span>
                </Button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-3 sm:mt-7 sm:gap-4 sm:p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-500">
                  {activeExamItem ? <Play size={18} fill="currentColor" /> : <Clock3 size={19} />}
                </span>
                <div className="min-w-0">
                  <span className="inline-flex rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-500">
                    {activeExamItem ? 'Ujian sedang berlangsung' : agendaEvents[0] ? 'Agenda terdekat' : 'Agenda lomba'}
                  </span>
                  <p className="mt-1 truncate text-xs font-bold text-slate-100 sm:text-sm">
                    {activeExamItem?.competition.title || agendaEvents[0]?.competitionTitle || 'Belum ada jadwal terdekat'}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                    {activeExamItem
                      ? String(activeExamItem.latest_attempt?.status ?? '').toUpperCase() === 'IN_PROGRESS'
                        ? 'Ada pengerjaan yang dapat dilanjutkan. Buka ruang ujian dari tombol di samping.'
                        : 'Sesi lomba sedang berlangsung dan akunmu telah terdaftar sebagai peserta.'
                      : agendaEvents[0]
                        ? agendaEvents[0].label + ' · ' + formatDateTime(agendaEvents[0].date)
                        : 'Jadwal berikutnya akan muncul setelah penyelenggara menetapkan tanggal penting.'}
                  </p>
                </div>
              </div>

              <div className="flex w-full shrink-0 items-center justify-end gap-2 md:w-auto">
                <Button size="sm" variant="outline" onClick={() => setAgendaOpen(true)} icon={<CalendarDays size={14} />}>
                  Agenda Lomba
                </Button>
                {activeExamItem ? (
                  <Link
                    to={examHref(activeExamItem)}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                  >
                    <Play size={13} fill="currentColor" />
                    {String(activeExamItem.latest_attempt?.status ?? '').toUpperCase() === 'IN_PROGRESS' ? 'Lanjutkan Ujian' : 'Masuk Ujian'}
                  </Link>
                ) : agendaEvents[0] ? (
                  <Link
                    to={'/lomba/' + encodeURIComponent(agendaEvents[0].competitionSlug)}
                    className="btn-outline px-3 py-2 text-xs"
                  >
                    Detail Lomba <ChevronRight size={14} />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </Card>

        <section className="my-competitions-summary min-w-0" aria-label="Ringkasan keikutsertaan lomba">
          <button
            type="button"
            aria-controls="my-competitions-summary-grid"
            aria-expanded={summaryExpanded}
            aria-label={summaryExpanded ? 'Ciutkan ringkasan keikutsertaan' : 'Tampilkan ringkasan keikutsertaan'}
            onClick={() => setSummaryExpanded((expanded) => !expanded)}
            className="mb-2.5 flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-900/85 px-3 py-2.5 text-left shadow-sm shadow-black/10 transition hover:border-slate-700 sm:hidden"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-extrabold text-slate-100">Ringkasan Keikutsertaan</span>
              <span className="truncate text-[10px] font-medium text-slate-400">{counts.all.toLocaleString('id-ID')} lomba · {counts.in_progress.toLocaleString('id-ID')} sedang berlangsung</span>
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/60 text-slate-300">
              <ChevronDown size={16} className={'transition-transform duration-200 ' + (summaryExpanded ? 'rotate-180' : '')} />
            </span>
          </button>
          <div
            id="my-competitions-summary-grid"
            className={(summaryExpanded ? 'grid ' : 'hidden sm:grid ') + 'grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4'}
          >
            <SummaryCard
              label="Total Lomba Diikuti"
              value={counts.all}
              icon={<Trophy size={18} />}
              footnote={counts.registration + ' pendaftaran'}
            />
            <SummaryCard
              label="Sedang Berlangsung"
              value={counts.in_progress}
              icon={<Clock3 size={18} />}
              tone="green"
              footnote="Pelaksanaan"
            />
            <SummaryCard
              label="Menunggu Hasil"
              value={counts.waiting_result}
              icon={<AlertCircle size={18} />}
              tone="violet"
              footnote="Proses penilaian"
            />
            <SummaryCard
              label="Hasil Diumumkan"
              value={counts.result_published}
              icon={<CheckCircle2 size={18} />}
              tone="blue"
              footnote={items.reduce((sum, item) => sum + item.published_certificate_count, 0) + ' piagam terbit'}
            />
          </div>
        </section>

        <Card className="rounded-2xl border border-slate-800/90 bg-slate-900/90 p-4 shadow-lg shadow-black/10 sm:p-5">
          <div className="space-y-4">
            <div className="my-competitions-toolbar-top flex min-w-0 items-center gap-2.5">
              <label className="relative block min-w-0 flex-1">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari lomba atau peserta..."
                  aria-label="Cari lomba atau peserta"
                  className="input w-full py-2.5 pl-10 text-xs sm:text-sm"
                />
              </label>
              <div className="flex shrink-0 items-center rounded-xl border border-slate-700/70 bg-slate-800/70 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Tampilan grid"
                  aria-pressed={viewMode === 'grid'}
                  className={'flex h-9 w-9 items-center justify-center rounded-lg transition ' + (viewMode === 'grid'
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-950/40'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-100')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Tampilan daftar"
                  aria-pressed={viewMode === 'list'}
                  className={'flex h-9 w-9 items-center justify-center rounded-lg transition ' + (viewMode === 'list'
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-950/40'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-100')}
                >
                  <List size={16} />
                </button>
              </div>
            </div>

            <div className="my-competitions-filter-row border-t border-slate-800/80 pt-3.5">
              <div className="hidden flex-wrap gap-2 sm:flex" role="tablist" aria-label="Filter status lomba">
                {FILTERS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === tab.id}
                    onClick={() => setFilter(tab.id)}
                    className={'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold transition sm:text-[11px] ' + (filter === tab.id
                      ? 'border-indigo-500 bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-950/40'
                      : 'border-slate-700/70 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100')}
                  >
                    <span>{tab.label}</span>
                    <span className={'rounded-full px-1.5 py-0.5 text-[9px] tabular-nums ' + (filter === tab.id ? 'bg-white/15 text-white' : 'bg-slate-950/70 text-slate-400')}>
                      {counts[tab.id]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="my-competitions-mobile-filter-switcher flex items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-950/55 p-1.5 sm:hidden" role="group" aria-label="Navigasi filter lomba">
                <button
                  type="button"
                  aria-label="Filter sebelumnya"
                  onClick={() => stepFilter(-1)}
                  disabled={activeFilterIndex <= 0}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/70 text-slate-200 transition hover:border-indigo-400/35 hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <span className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1 text-center" aria-live="polite">
                  <span className="truncate text-xs font-extrabold text-slate-100">{FILTERS[activeFilterIndex].label}</span>
                  <span className="shrink-0 rounded-full border border-indigo-400/15 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-indigo-300">
                    {counts[filter]}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Filter berikutnya"
                  onClick={() => stepFilter(1)}
                  disabled={activeFilterIndex >= FILTERS.length - 1}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/70 text-slate-200 transition hover:border-indigo-400/35 hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3' : 'grid grid-cols-1 gap-3'}>
            {[0, 1, 2].map((value) => (
              <Card key={value} className="animate-pulse overflow-hidden">
                <div className={viewMode === 'grid' ? 'aspect-[16/10] bg-slate-800 sm:aspect-[16/8] lg:aspect-auto lg:h-40' : 'h-12 bg-slate-800'} />
                <div className="space-y-2 p-3 sm:space-y-3 sm:p-4">
                  <div className="h-4 w-32 rounded bg-slate-800" />
                  <div className="h-5 w-3/4 rounded bg-slate-800" />
                  <div className="h-3 w-1/2 rounded bg-slate-800" />
                  <div className="h-12 rounded-xl bg-slate-800 sm:h-16" />
                </div>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card className="p-7 text-center sm:p-9">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500"><AlertCircle size={22} /></span>
            <h2 className="mt-3 text-sm font-bold text-slate-100">Daftar lomba belum dapat dimuat</h2>
            <p className="mx-auto mt-2 max-w-lg break-words text-xs leading-relaxed text-slate-400">{error}</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>Coba lagi</Button>
          </Card>
        ) : visibleItems.length === 0 ? (
          <Card className="p-8 text-center sm:p-10">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Trophy size={26} /></span>
            <h2 className="mt-4 text-sm font-bold text-slate-100">{items.length === 0 ? 'Belum ada lomba yang terdaftar' : 'Tidak ada lomba yang cocok'}</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              {items.length === 0
                ? 'Lomba yang kamu ikuti akan muncul di sini setelah pendaftaran tercatat. Mulai dengan menjelajahi lomba yang tersedia.'
                : 'Coba ubah kata kunci pencarian atau filter status untuk menemukan lomba yang kamu cari.'}
            </p>
            {items.length === 0 ? (
              <Link to="/home" className="btn-primary mt-5 inline-flex px-4 py-2.5 text-xs">Jelajahi Lomba</Link>
            ) : (
              <Button size="sm" className="mt-5" variant="outline" onClick={() => { setQuery(''); setFilter('all'); }}>Hapus Filter</Button>
            )}
          </Card>
        ) : (
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3' : 'grid grid-cols-1 gap-3'}>
            {visibleItems.map((item) => (
              <CompetitionCard
                key={item.entry_id}
                item={item}
                viewMode={viewMode}
                onOpenDetails={setSelectedItem}
                onOpenCertificates={openCertificates}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-400">
          <span>Data keikutsertaan berasal dari pendaftaran dan identitas peserta kanonis akunmu.</span>
          <span>{items.length.toLocaleString('id-ID')} lomba tercatat</span>
        </div>
      </div>

      <AgendaModal open={agendaOpen} onClose={() => setAgendaOpen(false)} events={agendaEvents} />
      <CompetitionDetailModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onOpenCertificates={openCertificates}
      />
      <CertificateHistoryModal
        open={certificatesOpen}
        onClose={() => setCertificatesOpen(false)}
        userId={user.id}
        items={items}
        competitionFilter={certificateCompetitionFilter}
      />
    </main>
  );
}

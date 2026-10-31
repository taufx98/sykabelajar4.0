import { useEffect, useMemo, useState } from 'react';
import {
  Award, CalendarClock, CheckCircle2, ChevronRight, ClipboardList,
  Clock3, GraduationCap, Search, Trophy, Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { listMyCompetitionDashboard, type ParticipantDashboardItem } from '@/services/participant.service';

type DashboardStatus = 'pending' | 'rejected' | 'cancelled' | 'registered' | 'in_progress' | 'waiting_result' | 'result_published';
type DashboardFilter = 'all' | 'registration' | 'in_progress' | 'waiting_result' | 'result_published';

const FILTERS: Array<{ id: DashboardFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'registration', label: 'Pendaftaran' },
  { id: 'in_progress', label: 'Sedang berlangsung' },
  { id: 'waiting_result', label: 'Menunggu hasil' },
  { id: 'result_published', label: 'Hasil diumumkan' },
];

const STATUS_META: Record<DashboardStatus, { label: string; className: string }> = {
  pending: { label: 'Menunggu persetujuan', className: 'border-amber-500/25 bg-amber-500/10 text-amber-500' },
  rejected: { label: 'Pendaftaran ditolak', className: 'border-rose-500/25 bg-rose-500/10 text-rose-500' },
  cancelled: { label: 'Dibatalkan', className: 'border-slate-500/25 bg-slate-500/10 text-fg-muted' },
  registered: { label: 'Terdaftar', className: 'border-sky-500/25 bg-sky-500/10 text-sky-500' },
  in_progress: { label: 'Sedang berlangsung', className: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-500' },
  waiting_result: { label: 'Menunggu hasil', className: 'border-violet-500/25 bg-violet-500/10 text-violet-500' },
  result_published: { label: 'Hasil diumumkan', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500' },
};

const REGISTRATION_FILTER_STATUSES: DashboardStatus[] = ['pending', 'rejected', 'cancelled', 'registered'];

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
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(date);
}

function competitionDate(item: ParticipantDashboardItem) {
  const start = formatDate(item.competition.starts_at);
  const end = formatDate(item.competition.ends_at);
  if (start && end && start !== end) return start + ' – ' + end;
  if (start) return start;
  const deadline = formatDate(item.competition.registration_ends_at);
  return deadline ? 'Pendaftaran hingga ' + deadline : 'Jadwal belum ditentukan';
}

function statusDescription(item: ParticipantDashboardItem, status: DashboardStatus) {
  if (status === 'pending') return 'Pendaftaran sudah dikirim dan sedang menunggu pemeriksaan penyelenggara.';
  if (status === 'rejected') return item.registration?.rejection_reason || 'Pendaftaran belum disetujui. Buka detail lomba untuk informasi lebih lanjut.';
  if (status === 'cancelled') {
    return String(item.competition.status).toUpperCase() === 'CANCELLED'
      ? 'Lomba ini telah dibatalkan oleh penyelenggara.'
      : 'Pendaftaran ini sudah dibatalkan.';
  }
  if (status === 'result_published') return 'Hasil resmi lomba sudah dapat dilihat.';
  if (status === 'waiting_result') {
    return item.latest_attempt?.status === 'FINALIZED'
      ? 'Pengerjaan sudah selesai. Nilai dan peringkat tampil setelah pengumuman resmi.'
      : 'Jawaban sedang diproses atau dinilai oleh penyelenggara.';
  }
  if (status === 'in_progress') {
    return item.latest_attempt?.status === 'IN_PROGRESS'
      ? 'Kamu memiliki pengerjaan yang dapat dilanjutkan.'
      : 'Sesi lomba sedang berlangsung. Pastikan kamu siap sebelum masuk ruang ujian.';
  }
  return 'Pendaftaranmu tercatat. Pantau jadwal dan informasi lomba di halaman detail.';
}

function SummaryCard({
  label, value, icon, tone = 'default',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'default' | 'blue' | 'violet' | 'green';
}) {
  const tones = {
    default: 'bg-surface-elevated text-fg-muted',
    blue: 'bg-sky-500/10 text-sky-500',
    violet: 'bg-violet-500/10 text-violet-500',
    green: 'bg-emerald-500/10 text-emerald-500',
  };
  return (
    <Card className="flex min-w-0 items-center gap-3 p-4">
      <span className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ' + tones[tone]}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-tight tabular-nums text-fg">{value}</span>
        <span className="mt-1 block truncate text-[11px] text-fg-muted">{label}</span>
      </span>
    </Card>
  );
}

function CompetitionCard({ item }: { item: ParticipantDashboardItem }) {
  const status = classifyItem(item);
  const meta = STATUS_META[status];
  const competition = item.competition;
  const isCollective = item.participant_type === 'COLLECTIVE';
  const attemptStatus = String(item.latest_attempt?.status ?? '').toUpperCase();
  const canEnterExam = !isCollective
    && Boolean(item.participant?.id)
    && (competition.status === 'LIVE' || attemptStatus === 'IN_PROGRESS');
  const href = isCollective
    ? (item.result?.published || item.published_certificate_count > 0 ? '/profile/collective-history' : '/peserta-kolektif')
    : canEnterExam
      ? '/lomba/' + encodeURIComponent(competition.slug) + '/kerja'
      : '/lomba/' + encodeURIComponent(competition.slug);
  const actionLabel = isCollective
    ? (item.result?.published || item.published_certificate_count > 0 ? 'Lihat riwayat' : 'Buka portal kolektif')
    : canEnterExam
      ? attemptStatus === 'IN_PROGRESS' ? 'Lanjutkan ujian' : 'Masuk ruang ujian'
      : 'Detail lomba';
  const certificateHref = isCollective ? '/profile/collective-history' : '/awards';

  return (
    <Card className="group flex h-full min-w-0 flex-col overflow-hidden transition hover:border-accent/35 hover:shadow-md">
      <div className="flex min-w-0 gap-4 p-4 sm:p-5">
        <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-elevated sm:h-28 sm:w-24">
          {competition.poster_url ? (
            <img src={competition.poster_url} alt={'Poster ' + competition.title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-accent"><Trophy size={28} /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ' + meta.className}>{meta.label}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1 text-[10px] font-medium text-fg-muted">
              {isCollective ? <Users size={11} /> : <GraduationCap size={11} />}
              {isCollective ? 'Peserta kolektif' : 'Peserta individu'}
            </span>
          </div>
          <h2 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-fg sm:text-lg">{competition.title}</h2>
          <p className="mt-1 truncate text-xs text-fg-muted">{competition.category || 'Kompetisi'}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
            <CalendarClock size={13} className="shrink-0" />
            <span>{competitionDate(item)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col border-t border-border/70 px-4 py-4 sm:px-5">
        <p className="min-h-10 text-xs leading-relaxed text-fg-muted">{statusDescription(item, status)}</p>

        {status === 'result_published' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-surface-elevated/50 p-3">
              <span className="block text-[10px] text-fg-muted">Skor akhir</span>
              <strong className="mt-1 block text-xl font-bold tabular-nums text-fg">
                {item.result.score == null ? '—' : Number(item.result.score).toLocaleString('id-ID')}
              </strong>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated/50 p-3">
              <span className="block text-[10px] text-fg-muted">Peringkat</span>
              <strong className="mt-1 block text-xl font-bold tabular-nums text-fg">
                {item.result.rank == null ? '—' : '#' + Number(item.result.rank).toLocaleString('id-ID')}
              </strong>
            </div>
          </div>
        )}

        {item.registration?.status === 'REJECTED' && item.registration.rejection_reason && (
          <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-500">
            Alasan: {item.registration.rejection_reason}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
          <span className="text-[10px] text-fg-muted">
            {item.published_certificate_count > 0
              ? item.published_certificate_count + ' piagam terbit'
              : item.certificate_count > 0
                ? item.certificate_count + ' piagam dalam proses'
                : 'Piagam belum tersedia'}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {item.published_certificate_count > 0 && (
              <Link to={certificateHref} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-fg-secondary transition hover:border-accent/40 hover:text-accent">
                <Award size={14} />Piagam
              </Link>
            )}
            <Link to={href} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110">
              {actionLabel}<ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function MyCompetitionsPage() {
  const { user, isGuest } = useApp();
  const [items, setItems] = useState<ParticipantDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user || isGuest) {
      setItems([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void listMyCompetitionDashboard()
      .then((rows) => { if (active) setItems(rows); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Gagal memuat daftar lomba.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, isGuest, refreshKey]);

  const counts = useMemo(() => {
    const statuses = items.map(classifyItem);
    return {
      all: items.length,
      registration: statuses.filter((status) => REGISTRATION_FILTER_STATUSES.includes(status)).length,
      in_progress: statuses.filter((status) => status === 'in_progress').length,
      waiting_result: statuses.filter((status) => status === 'waiting_result').length,
      result_published: statuses.filter((status) => status === 'result_published').length,
    };
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
        item.participant_type,
      ].filter(Boolean).join(' ').toLocaleLowerCase('id-ID');
      return matchesFilter && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [items, filter, query]);

  if (isGuest || !user) {
    return (
      <div className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center px-4 py-10">
        <Card className="w-full p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><ClipboardList size={26} /></span>
          <h1 className="mt-4 text-xl font-bold text-fg">Lomba Saya</h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">Masuk ke akun SykaBelajar untuk melihat pendaftaran, pengerjaan, hasil, dan piagam lombamu.</p>
          <Link to="/login?redirect=%2Flomba-saya" className="mt-5 inline-flex"><Button>Masuk ke akun</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 pb-24 md:px-6 md:py-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Peserta</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-fg sm:text-3xl">Lomba Saya</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">Pantau pendaftaran, jadwal pengerjaan, hasil, dan piagam dalam satu tempat.</p>
        </div>
        <Link to="/home" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-accent hover:underline">Jelajahi lomba<ChevronRight size={14} /></Link>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Total lomba" value={counts.all} icon={<ClipboardList size={19} />} />
        <SummaryCard label="Sedang berlangsung" value={counts.in_progress} icon={<Clock3 size={19} />} tone="blue" />
        <SummaryCard label="Menunggu hasil" value={counts.waiting_result} icon={<CalendarClock size={19} />} tone="violet" />
        <SummaryCard label="Hasil diumumkan" value={counts.result_published} icon={<CheckCircle2 size={19} />} tone="green" />
      </div>

      <Card className="p-3 sm:p-4">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama lomba atau kategori..." aria-label="Cari lomba saya" className="input w-full pl-9" />
        </label>
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter lomba">
          {FILTERS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={'shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition ' + (filter === tab.id ? 'bg-accent text-white shadow-sm' : 'bg-surface-elevated text-fg-muted hover:text-fg')}
            >
              {tab.label}
              <span className={'ml-1.5 tabular-nums ' + (filter === tab.id ? 'text-white/80' : 'text-fg-muted')}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((value) => (
            <Card key={value} className="animate-pulse p-5">
              <div className="flex gap-4">
                <div className="h-24 w-20 shrink-0 rounded-xl bg-surface-elevated" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="h-4 w-32 rounded bg-surface-elevated" />
                  <div className="h-5 w-3/4 rounded bg-surface-elevated" />
                  <div className="h-3 w-1/2 rounded bg-surface-elevated" />
                </div>
              </div>
              <div className="mt-5 h-14 rounded-xl bg-surface-elevated" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-7 text-center">
          <p className="font-semibold text-fg">Daftar lomba belum dapat dimuat</p>
          <p className="mt-2 text-sm text-fg-muted">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>Coba lagi</Button>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card className="p-8 text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Trophy size={26} /></span>
          <h2 className="mt-4 font-semibold text-fg">{items.length === 0 ? 'Belum ada lomba yang terdaftar' : 'Tidak ada lomba yang cocok'}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
            {items.length === 0
              ? 'Lomba yang kamu ikuti akan muncul di sini setelah pendaftaran tercatat. Mulai dengan menjelajahi lomba yang tersedia.'
              : 'Coba gunakan kata kunci atau filter yang berbeda.'}
          </p>
          {items.length === 0
            ? <Link to="/home" className="mt-5 inline-flex"><Button>Jelajahi lomba</Button></Link>
            : <Button className="mt-5" variant="outline" onClick={() => { setQuery(''); setFilter('all'); }}>Hapus filter</Button>}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleItems.map((item) => <CompetitionCard key={item.entry_id} item={item} />)}
        </div>
      )}
    </div>
  );
}

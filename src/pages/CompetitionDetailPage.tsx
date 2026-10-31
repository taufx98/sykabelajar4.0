import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock3, FileText,
  Info, Landmark, Medal, ShieldCheck, Trophy, Users, X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CommentsSection } from '@/components/ui/Comments';
import { CompetitionRegistrationModal } from '@/components/competition/CompetitionRegistrationModal';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug, getCompetitionDetails, syncCompetitionRegistrationStatus } from '@/services/competition.service';
import { listCompetitionPosts } from '@/services/social.service';
import { CATEGORY_LABELS, LEVEL_LABELS } from '@/data/catalog';
import { countdown } from '@/lib/utils';

function statusUi(status: string) {
  if (status === 'REGISTRATION_OPEN') return { label: 'Pendaftaran dibuka', color: 'moss' as const };
  if (status === 'LIVE') return { label: 'Sedang berlangsung', color: 'warn' as const };
  if (status === 'RESULT_PUBLISHED' || status === 'ARCHIVED') return { label: 'Selesai', color: 'default' as const };
  if (status === 'REGISTRATION_CLOSED' || status === 'SUBMISSION_CLOSED' || status === 'GRADING') return { label: 'Pendaftaran ditutup', color: 'info' as const };
  if (status === 'CANCELLED' || status === 'SUSPENDED') return { label: 'Tidak tersedia', color: 'default' as const };
  return { label: 'Segera dibuka', color: 'default' as const };
}

function dateTime(value?: string | null) {
  if (!value) return 'Belum ditentukan';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value)) + ' WIB';
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function initials(value?: string | null) {
  return String(value ?? 'P').trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase() || 'P';
}

function CountdownCard({ cd }: { cd: ReturnType<typeof countdown> }) {
  const parts: Array<[number, string]> = [[cd.days, 'Hari'], [cd.hours, 'Jam'], [cd.minutes, 'Menit'], [cd.seconds, 'Detik']];
  return <div className="grid grid-cols-4 gap-2 text-center">
    {parts.map(([value, label]) => <div key={label} className="rounded-xl border border-border bg-slate-950/45 p-2.5">
      <span className="block font-mono text-xl font-extrabold tabular-nums text-fg sm:text-2xl">{String(value).padStart(2, '0')}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-fg-muted sm:text-[10px]">{label}</span>
    </div>)}
  </div>;
}

function SectionHeading({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return <div className="mb-4 flex items-center gap-3 border-b border-border/80 pb-3">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">{icon}</div>
    <div className="min-w-0"><h2 className="font-bold text-fg">{title}</h2><p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{subtitle}</p></div>
  </div>;
}

function Stat({ icon, label, value, suffix, accent }: { icon: ReactNode; label: string; value: unknown; suffix?: string; accent?: boolean }) {
  return <div className="min-w-0 rounded-xl border border-border/80 bg-surface-elevated/45 p-3 sm:p-3.5">
    <p className="flex items-center gap-1.5 truncate text-[11px] text-fg-muted"><span className="shrink-0 text-blue-400">{icon}</span>{label}</p>
    <div className="mt-1 flex min-w-0 items-baseline gap-1">
      <span className={'truncate text-base font-extrabold sm:text-lg ' + (accent ? 'text-amber-400' : 'text-fg')}>{value == null || value === '' ? '—' : typeof value === 'number' ? value.toLocaleString('id-ID') : String(value)}</span>
      {suffix && <span className="shrink-0 text-[10px] text-fg-muted">{suffix}</span>}
    </div>
  </div>;
}

function timelineStageActive(startValue: string | null | undefined, endValue: string | null | undefined, now: number) {
  if (!startValue) return false;
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(start) && now >= start && now < end;
}

function TimelineItem({ label, value, active, last, now }: { label: string; value?: string | null; active?: boolean; last?: boolean; now: number }) {
  const passed = Boolean(value && new Date(value).getTime() < now && !active);
  return <div className="relative flex gap-3">
    <div className="flex w-4 shrink-0 flex-col items-center">
      <span className={'relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full ' + (active ? 'bg-emerald-400 ring-4 ring-emerald-400/15' : passed ? 'bg-accent/70' : 'border border-slate-600 bg-slate-700')}/>
      {!last && <span className="absolute bottom-0 left-[5.5px] top-4 w-px bg-border"/>}
    </div>
    <div className={'min-w-0 flex-1 ' + (last ? 'pb-0' : 'pb-5')}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={'text-xs font-semibold ' + (active ? 'text-emerald-400' : 'text-fg-secondary')}>{label}</p>
        {active && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/>Berlangsung</span>}
        {passed && <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] font-medium text-fg-muted">Terlewati</span>}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{dateTime(value)}</p>
    </div>
  </div>;
}

function Rule({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="rounded-xl border border-border bg-surface-elevated/35 p-3">
    <p className="text-[10px] text-fg-muted">{label}</p>
    <p className={'mt-1 text-xs font-bold ' + (accent ? 'text-accent' : 'text-fg')}>{value}</p>
  </div>;
}

export function CompetitionDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { isGuest, user, toast } = useApp();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [postId, setPostId] = useState<string | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [juknisOpen, setJuknisOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const refreshDetail = async (competitionId: string) => {
    const refreshed = await getCompetitionDetails(competitionId);
    if (refreshed) setDetail(refreshed);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const base = await getCompetitionBySlug(slug);
        if (!base) {
          if (active) {
            setDetail(null);
            setPostId(null);
            setError('Uji kompetensi tidak ditemukan.');
          }
          return;
        }
        const [next, posts] = await Promise.all([
          getCompetitionDetails(String(base.id)),
          listCompetitionPosts(String(base.id), 1),
        ]);
        if (active) {
          setDetail(next);
          setPostId(posts[0]?.id ?? null);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Gagal memuat detail lomba.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    const competitionId = String(detail?.competition?.id ?? '');
    const currentStatus = String(detail?.competition?.status ?? '');
    if (!competitionId || !['PUBLISHED', 'REGISTRATION_OPEN'].includes(currentStatus)) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const latestStatus = await syncCompetitionRegistrationStatus(competitionId);
        if (!active || !latestStatus || latestStatus === currentStatus) return;
        const refreshed = await getCompetitionDetails(competitionId);
        if (active && refreshed) setDetail(refreshed);
      } catch {
        // A transient status-sync failure should not break the public detail page.
      }
    }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [detail?.competition?.id, detail?.competition?.status]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const competition = detail?.competition;
  const rules = detail?.rules;
  const organizer = detail?.organizer;
  const rewards = detail?.rewards ?? [];
  const levels = detail?.levels ?? [];
  const participantCount = Number(detail?.participantCount ?? competition?.participant_count ?? 0);
  const questionCount = Number(detail?.questionCount ?? 0);
  const capacity = rules?.max_participants == null ? null : Math.max(0, Number(rules.max_participants));
  const remainingCapacity = capacity == null ? null : Math.max(0, capacity - participantCount);

  const cd = competition?.registration_ends_at
    ? countdown(String(competition.registration_ends_at))
    : { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const registrationStartMs = competition?.registration_starts_at ? new Date(String(competition.registration_starts_at)).getTime() : null;
  const registrationEndMs = competition?.registration_ends_at ? new Date(String(competition.registration_ends_at)).getTime() : null;
  const registrationWindowOpen = (registrationStartMs === null || clock >= registrationStartMs)
    && (registrationEndMs === null || clock <= registrationEndMs);
  const joinable = competition?.status === 'REGISTRATION_OPEN' && registrationWindowOpen && !cd.expired && (capacity == null || remainingCapacity! > 0);
  const status = statusUi(String(competition?.status ?? ''));
  const category = CATEGORY_LABELS[String(competition?.category ?? '')] ?? String(competition?.category ?? 'Kompetisi');
  const grades = useMemo<string[]>(() => {
    // Use one authoritative eligibility source. Combining level, rule, and
    // broad target arrays caused duplicates and displayed grades not actually
    // allowed by the published registration rules.
    const ruleGrades = Array.isArray(rules?.allowed_grades) ? rules.allowed_grades : [];
    const levelGrades = levels.flatMap((level: any) => Array.isArray(level.allowed_grades) ? level.allowed_grades : []);
    const targetGrades = Array.isArray(competition?.target_grades) ? competition.target_grades : [];
    const source = ruleGrades.length ? ruleGrades : levelGrades.length ? levelGrades : targetGrades;

    const normalizeGrade = (value: unknown) => {
      const raw = String(value ?? '').trim().toLowerCase();
      const compact = raw.replace(/[\s_-]+/g, '');
      if (/^sd(?:[1-6])?$/.test(compact) || compact === 'sekolahdasar') return 'sd';
      if (/^smp(?:[7-9])?$/.test(compact) || compact === 'sekolahmenengahpertama') return 'smp';
      if (/^sma(?:10|11|12)?$/.test(compact) || /^smk(?:10|11|12)?$/.test(compact) || compact === 'sekolahmenengahatas') return 'sma';
      if (compact === 'smasmk' || compact === 'sma/smk') return 'sma/smk';
      if (compact === 'mahasiswa' || compact === 'kuliah') return 'mahasiswa';
      if (compact === 'profesional' || compact === 'professional') return 'profesional';
      if (compact === 'alumni') return 'alumni';
      return raw;
    };

    const normalized: string[] = source.map((grade: unknown) => normalizeGrade(grade)).filter((grade: unknown): grade is string => Boolean(grade));
    return [...new Set<string>(normalized)];
  }, [levels, rules?.allowed_grades, competition?.target_grades]);


  if (loading) return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
    <div className="h-72 animate-pulse rounded-3xl surface-elevated"/>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((value) => <div key={value} className="h-20 animate-pulse rounded-2xl surface-elevated"/>)}</div>
    <Card className="space-y-3 p-6"><div className="h-5 w-2/3 animate-pulse rounded surface-elevated"/><div className="h-4 w-4/5 animate-pulse rounded surface-elevated"/></Card>
  </div>;

  if (!competition) return <div className="mx-auto max-w-xl p-6 md:p-10">
    <Card className="p-8 text-center sm:p-10">
      <Trophy size={38} className="mx-auto mb-3 text-fg-muted"/>
      <h1 className="text-lg font-bold text-fg">Lomba tidak ditemukan</h1>
      <p className="mt-2 text-sm text-fg-muted">{error || 'Uji kompetensi ini tidak tersedia atau tautannya sudah berubah.'}</p>
      <Button variant="outline" className="mt-5" onClick={() => navigate(-1)}>Kembali</Button>
    </Card>
  </div>;

  const description = String(competition.description || competition.short_description || 'Deskripsi lomba belum ditambahkan penyelenggara.');
  // The timeline follows the actual schedule timestamps, not only the competition
  // status field, which may lag behind its schedule. Each marker remains green
  // for the phase between its timestamp and the next scheduled event.
  const isRegistrationActive = timelineStageActive(
    competition.registration_starts_at,
    competition.registration_ends_at,
    clock,
  ) || (
    !competition.registration_starts_at &&
    competition.status === 'REGISTRATION_OPEN' &&
    (registrationEndMs === null || clock <= registrationEndMs)
  );
  const isRegistrationDeadlineActive = timelineStageActive(
    competition.registration_ends_at,
    competition.starts_at,
    clock,
  );
  const isExamTimelineActive = timelineStageActive(
    competition.starts_at,
    competition.ends_at,
    clock,
  ) || (
    !competition.starts_at &&
    competition.status === 'LIVE' &&
    (competition.ends_at == null || clock < new Date(String(competition.ends_at)).getTime())
  );
  const isExamEndActive = timelineStageActive(
    competition.ends_at,
    competition.announcement_at,
    clock,
  );
  const isAnnouncementActive = ['RESULT_PUBLISHED', 'ARCHIVED'].includes(String(competition.status))
    || timelineStageActive(competition.announcement_at, null, clock);
  const isExamLive = competition.status === 'LIVE';
  const isCompleted = ['RESULT_PUBLISHED', 'ARCHIVED'].includes(String(competition.status));
  const startedDate = shortDate(competition.starts_at);
  const organizerName = String(organizer?.name ?? 'Penyelenggara');
  const remainingText = remainingCapacity == null ? 'Tidak dibatasi' : remainingCapacity.toLocaleString('id-ID');

  return <div className="competition-detail-theme min-h-screen pb-10 surface-bg text-fg">
    <main className="mx-auto max-w-6xl space-y-6 p-3 sm:p-5 lg:p-7">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/80 p-5 shadow-sm sm:p-7 lg:p-8">
        <div className="pointer-events-none absolute -right-14 -top-20 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl"/>
        <div className="pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-purple-600/15 blur-3xl"/>
        {competition.poster_url && <img src={competition.poster_url} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.08]"/>}
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-blue-400 sm:text-xs"><Trophy size={12} className="text-blue-400"/> {category}</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-400 sm:text-xs"><Users size={12} className="text-emerald-400"/> {participantCount.toLocaleString('id-ID')} Peserta Terdaftar</span>
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-300 sm:text-xs"><Landmark size={12} className="text-amber-400"/> <span className="truncate">Penyelenggara: {organizerName}</span></span>
          </div>

          <div className="mt-4 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div className="max-w-3xl min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{competition.title}</h1>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[11px] font-medium text-slate-400">Tingkat:</span>
                {grades.length ? grades.map((grade: string) => <span key={grade} className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[10px] font-semibold text-slate-200 sm:text-xs">{LEVEL_LABELS[grade.toLowerCase()] ?? (grade === 'mahasiswa' ? 'Mahasiswa' : grade === 'profesional' ? 'Profesional' : grade === 'alumni' ? 'Alumni' : grade === 'sma/smk' ? 'SMA/SMK' : grade.toUpperCase())}</span>) : <span className="text-xs text-slate-400">Semua jenjang</span>}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-700/80 pt-5 sm:grid-cols-4">
            <Stat icon={<Users size={14}/>} label="Total Peserta" value={participantCount} suffix="Orang"/>
            <Stat icon={<Trophy size={14}/>} label="Soal Tersedia" value={questionCount} suffix="Soal"/>
            <Stat icon={<CalendarDays size={14}/>} label="Tanggal Mulai" value={startedDate}/>
            <Stat icon={<Landmark size={14}/>} label="Penyelenggara" value={organizerName} accent/>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3 lg:gap-6">
        <aside className="order-1 space-y-5 lg:sticky lg:top-24 lg:order-2">
          <Card className="relative overflow-hidden border border-blue-500/25 bg-gradient-to-br from-slate-800/95 via-slate-800/90 to-indigo-950/70 p-5 shadow-xl sm:p-6">
            <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl"/>
            <div className="relative">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <span className={'inline-flex items-center gap-2 text-[11px] font-bold ' + (joinable ? 'text-emerald-400' : isExamLive ? 'text-amber-400' : 'text-fg-muted')}>
                  <span className={'h-2 w-2 rounded-full ' + (joinable ? 'animate-pulse bg-emerald-400' : isExamLive ? 'bg-amber-400' : 'bg-slate-500')}/>
                  {joinable ? 'Pendaftaran Dibuka' : isExamLive ? 'Ujian Berlangsung' : status.label}
                </span>
                {capacity != null && <span className="rounded-full border border-border bg-slate-950/35 px-2.5 py-1 text-[10px] text-fg-muted">Sisa Kuota: <strong className={remainingCapacity === 0 ? 'text-rose-400' : 'text-emerald-400'}>{remainingText}</strong></span>}
              </div>

              {joinable ? <>
                <h2 className="text-xl font-bold text-white">Siap ikut {competition.title}?</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">Lengkapi syarat dan kirim pendaftaran sebelum batas waktu atau kuota terpenuhi.</p>
                <div className="mt-5"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Waktu tersisa untuk mendaftar</p><CountdownCard cd={cd}/></div>
              </> : isExamLive && questionCount > 0 ? <>
                <h2 className="text-xl font-bold text-white">Ujian sedang berlangsung</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">Jika sudah terdaftar dan mendapat akses, kamu dapat melanjutkan ke ruang ujian.</p>
              </> : isCompleted ? <>
                <h2 className="text-xl font-bold text-white">Kompetisi telah selesai</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">Terima kasih atas minatmu. Lihat jadwal dan informasi hasil pada halaman ini.</p>
              </> : <>
                <h2 className="text-xl font-bold text-white">{competition.status === 'REGISTRATION_CLOSED' ? 'Pendaftaran ditutup' : 'Siapkan dirimu'}</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">Periksa jadwal dan ketentuan. Tombol pendaftaran akan aktif sesuai periode yang ditetapkan penyelenggara.</p>
              </>}

              <div className="mt-5 space-y-2.5">
                <Button fullWidth size="lg" variant="outline" className="border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20" onClick={() => setJuknisOpen(true)} icon={<FileText size={15}/>}>Petunjuk Teknis (Juknis)</Button>
                {joinable && <Button fullWidth size="lg" className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 hover:opacity-95" onClick={() => setRegistrationOpen(true)} icon={<ArrowLeft className="rotate-180" size={16}/>}>{isGuest || !user ? 'Masuk untuk Daftar' : 'Daftar Sekarang'}</Button>}
                {isExamLive && questionCount > 0 && <Button fullWidth size="lg" onClick={() => navigate('/lomba/' + competition.slug + '/kerja')} disabled={!user || isGuest}>Kerjakan Uji Kompetensi</Button>}
                {isCompleted && <Link to={'/lomba/' + encodeURIComponent(competition.slug) + '/hasil'}><Button fullWidth size="lg" variant="outline" icon={<Trophy size={15}/>}>Lihat Hasil Resmi</Button></Link>}
              </div>

              <div className="mt-5 space-y-3 border-t border-slate-700/80 pt-4">
                <div className="flex items-start gap-2.5"><CalendarDays size={15} className="mt-0.5 shrink-0 text-blue-400"/><div><p className="text-xs font-semibold text-white">Mulai Lomba</p><p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{dateTime(competition.starts_at)}</p></div></div>
                <div className="flex items-start gap-2.5"><Clock3 size={15} className="mt-0.5 shrink-0 text-blue-400"/><div><p className="text-xs font-semibold text-white">Batas Pendaftaran</p><p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{dateTime(competition.registration_ends_at)}</p></div></div>
              </div>
            </div>
          </Card>
          <Card className="flex items-start gap-2.5 p-4">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent"/>
            <p className="text-[11px] leading-relaxed text-fg-muted">Pendaftaran disimpan pada akun SykaBelajar. Status persetujuan mengikuti ketentuan penyelenggara.</p>
          </Card>
        </aside>

        <div className="order-2 min-w-0 space-y-5 lg:col-span-2 lg:order-1">
          <Card className="p-5 sm:p-6">
            <SectionHeading icon={<Info size={17}/>} title="Tentang Lomba" subtitle={'Informasi umum dan penjelasan seputar ' + competition.title}/>
            <p className="whitespace-pre-line text-xs leading-6 text-fg-secondary sm:text-sm sm:leading-7">{description}</p>
            <div className="mt-4 flex items-start gap-3.5 rounded-xl border border-border bg-surface-elevated/50 p-3.5 sm:p-4">
              {organizer?.logoUrl ? <img src={organizer.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-border object-cover"/> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-blue-500 text-xs font-black text-white">{initials(organizerName)}</div>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex flex-wrap items-center gap-2 text-xs font-bold text-fg">{organizerName}<span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[9px] font-semibold text-cyan-400">Penyelenggara</span></h3></div>
                <p className="mt-1 text-[10px] leading-relaxed text-fg-muted sm:text-[11px]">{String(organizer?.description ?? '').trim() || 'Informasi profil penyelenggara belum dilengkapi.'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading icon={<CalendarDays size={17}/>} title="Jadwal Penting" subtitle="Gunakan waktu yang tersedia sebagai acuan"/>
            <div className="relative pl-1">
              <TimelineItem label="Pendaftaran Dibuka" value={competition.registration_starts_at} active={isRegistrationActive} now={clock}/>
              <TimelineItem label="Batas Akhir Pendaftaran" value={competition.registration_ends_at} active={isRegistrationDeadlineActive} now={clock}/>
              <TimelineItem label="Uji Kompetensi Dimulai" value={competition.starts_at} active={isExamTimelineActive} now={clock}/>
              <TimelineItem label="Uji Kompetensi Berakhir" value={competition.ends_at} active={isExamEndActive} now={clock}/>
              <TimelineItem label="Pengumuman Hasil" value={competition.announcement_at} active={isAnnouncementActive} now={clock} last/>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading icon={<ShieldCheck size={17}/>} title="Syarat Peserta" subtitle="Periksa sebelum mengirim pendaftaran"/>
            <div className="mb-4 flex flex-wrap gap-2">
              {grades.length ? grades.map((grade: string) => <span key={grade} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold text-blue-300">{LEVEL_LABELS[grade.toLowerCase()] ?? (grade === 'mahasiswa' ? 'Mahasiswa' : grade === 'profesional' ? 'Profesional' : grade === 'alumni' ? 'Alumni' : grade === 'sma/smk' ? 'SMA/SMK' : grade.toUpperCase())}</span>) : <span className="text-xs text-fg-muted">Tidak ada pembatasan jenjang yang ditampilkan.</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Rule label="Persetujuan Pendaftaran" value={rules?.approval_mode === 'AUTO' ? 'Otomatis' : 'Ditinjau Panitia'}/>
              <Rule label="Kuota Peserta" value={capacity == null ? 'Tidak dibatasi' : capacity.toLocaleString('id-ID') + ' Peserta'}/>
              <Rule label="Twibbon" value={rules?.require_twibbon ? 'Wajib' : 'Tidak wajib'} accent={Boolean(rules?.require_twibbon)}/>
              <Rule label="Bukti Media Sosial" value={rules?.require_social_proof ? 'Wajib' : 'Tidak wajib'} accent={Boolean(rules?.require_social_proof)}/>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading icon={<Medal size={17}/>} title="Hadiah & Apresiasi" subtitle="Penghargaan yang disiapkan penyelenggara"/>
            {rewards.length ? <div className="grid gap-2.5 sm:grid-cols-2">
              {rewards.map((reward: any, index: number) => {
                const rank = String(reward.rank_code ?? '');
                const label = rank === 'FIRST' ? 'Juara 1' : rank === 'SECOND' ? 'Juara 2' : rank === 'THIRD' ? 'Juara 3' : rank === 'PARTICIPANT' ? 'Peserta' : reward.title;
                return <div key={reward.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-elevated/25 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 font-extrabold text-amber-400">{index < 3 ? index + 1 : <Medal size={17}/>}</div>
                  <div className="min-w-0 flex-1"><p className="text-xs font-bold text-fg">{label || 'Penghargaan'}</p><p className="mt-1 text-[10px] text-fg-muted">{reward.emblem_name || 'Emblem digital'}{reward.certificate_enabled ? ' · Sertifikat' : ''}</p></div>
                  <span className="shrink-0 text-xs font-bold text-accent">+{Number(reward.points ?? 0).toLocaleString('id-ID')} XP</span>
                </div>;
              })}
            </div> : <p className="text-xs text-fg-muted">Detail hadiah belum ditambahkan penyelenggara.</p>}
          </Card>



          {postId ? <Card className="p-5 sm:p-6"><CommentsSection postId={postId}/></Card> : <Card className="p-4"><p className="text-[11px] text-fg-muted">Komentar akan tersedia setelah postingan lomba dibuat.</p></Card>}
        </div>
      </div>
    </main>

    <CompetitionRegistrationModal open={registrationOpen} competition={competition} rules={rules} slug={slug} onClose={() => setRegistrationOpen(false)} onRegistered={() => { void refreshDetail(String(competition.id)); }}/>

    {juknisOpen && <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setJuknisOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="juknis-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-elevated/40 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400"><FileText size={18}/></div><div className="min-w-0"><h2 id="juknis-title" className="truncate text-base font-bold text-fg sm:text-lg">Petunjuk Teknis (Juknis)</h2><p className="mt-0.5 text-xs text-fg-muted">{competition.title}</p></div></div>
          <button onClick={() => setJuknisOpen(false)} aria-label="Tutup Juknis" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-fg-muted transition hover:text-fg"><X size={17}/></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {competition.juknis_url ? <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-relaxed text-fg-muted">Dokumen petunjuk teknis yang dilampirkan penyelenggara.</p><a href={String(competition.juknis_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-accent hover:bg-surface-elevated">Buka sumber dokumen <ArrowLeft size={13} className="rotate-[135deg]"/></a></div>
            <iframe src={String(competition.juknis_url)} title={'Petunjuk teknis ' + competition.title} className="h-[55dvh] min-h-[280px] w-full rounded-xl border border-border bg-white"/>
          </> : <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-elevated/20 p-6 text-center">
            <FileText size={30} className="text-fg-muted"/>
            <h3 className="mt-3 font-bold text-fg">Juknis belum tersedia</h3>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-fg-muted">Penyelenggara belum melampirkan dokumen petunjuk teknis pada halaman lomba ini. Informasi jadwal dan syarat tetap dapat dilihat di halaman detail.</p>
          </div>}
        </div>
        <div className="flex justify-end border-t border-border p-4"><Button onClick={() => setJuknisOpen(false)}>Tutup</Button></div>
      </section>
    </div>}
  </div>;
}

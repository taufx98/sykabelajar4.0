import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, Clipboard, Clock3, FileText, Image as ImageIcon, Medal, ShieldCheck, Sparkles, Trophy, Users } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CommentsSection } from '@/components/ui/Comments';
import { CompetitionRegistrationModal } from '@/components/competition/CompetitionRegistrationModal';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug, getCompetitionDetails, syncCompetitionRegistrationStatus } from '@/services/competition.service';
import { listCompetitionPosts } from '@/services/social.service';
import { CATEGORY_LABELS, LEVEL_LABELS } from '@/data/catalog';
import { formatShortDate, countdown } from '@/lib/utils';

function statusUi(status: string) {
  if (status === 'REGISTRATION_OPEN') return { label: 'Pendaftaran dibuka', color: 'moss' as const };
  if (status === 'LIVE') return { label: 'Sedang berlangsung', color: 'warn' as const };
  if (status === 'RESULT_PUBLISHED' || status === 'ARCHIVED') return { label: 'Selesai', color: 'default' as const };
  if (status === 'REGISTRATION_CLOSED') return { label: 'Pendaftaran ditutup', color: 'info' as const };
  if (status === 'CANCELLED' || status === 'SUSPENDED') return { label: 'Tidak tersedia', color: 'default' as const };
  return { label: 'Segera dibuka', color: 'default' as const };
}

function dateTime(value?: string | null) {
  if (!value) return 'Belum ditentukan';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
}

function CountdownCard({ cd }: { cd: ReturnType<typeof countdown> }) {
  const parts: Array<[number, string]> = [[cd.days, 'Hari'], [cd.hours, 'Jam'], [cd.minutes, 'Menit'], [cd.seconds, 'Detik']];
  return <div className="grid grid-cols-4 gap-2">
    {parts.map(([value, label]) => <div key={label} className="rounded-xl border border-border bg-surface-elevated/40 p-2 text-center sm:p-3">
      <p className="font-mono text-xl font-bold tabular-nums text-accent sm:text-2xl">{String(value).padStart(2, '0')}</p>
      <p className="mt-1 text-[10px] text-fg-muted sm:text-xs">{label}</p>
    </div>)}
  </div>;
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: unknown }) {
  return <Card className="flex items-center gap-3 p-3.5 sm:p-4">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">{icon}</div>
    <div className="min-w-0">
      <p className="truncate text-lg font-bold text-fg sm:text-xl">{value == null || value === '' ? '—' : typeof value === 'number' ? value.toLocaleString('id-ID') : String(value)}</p>
      <p className="text-xs text-fg-muted">{label}</p>
    </div>
  </Card>;
}

function TimelineItem({ label, value, first, last }: { label: string; value?: string | null; first?: boolean; last?: boolean }) {
  const happened = Boolean(value && new Date(value).getTime() <= Date.now());
  return <div className="flex gap-3">
    <div className="flex w-4 shrink-0 flex-col items-center">
      <span className={'mt-1 h-3 w-3 rounded-full ' + (happened ? 'bg-accent' : 'border-2 border-border bg-card')} />
      {!last && <span className="mt-1 w-px flex-1 bg-border" />}
    </div>
    <div className={'min-w-0 flex-1 ' + (last ? 'pb-0' : 'pb-5')}>
      <p className="text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{dateTime(value)}</p>
    </div>
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
        // A transient status-sync failure should not break the detail page.
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
  const rewards = detail?.rewards ?? [];
  const levels = detail?.levels ?? [];
  const twibbons = detail?.twibbons ?? [];
  const cd = competition?.registration_ends_at
    ? countdown(String(competition.registration_ends_at))
    : { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const registrationStartMs = competition?.registration_starts_at ? new Date(String(competition.registration_starts_at)).getTime() : null;
  const registrationEndMs = competition?.registration_ends_at ? new Date(String(competition.registration_ends_at)).getTime() : null;
  const registrationWindowOpen = (registrationStartMs === null || clock >= registrationStartMs)
    && (registrationEndMs === null || clock <= registrationEndMs);
  const joinable = competition?.status === 'REGISTRATION_OPEN' && registrationWindowOpen && !cd.expired;
  const category = CATEGORY_LABELS[String(competition?.category ?? '')] ?? String(competition?.category ?? 'Kompetisi');
  const grades = useMemo(() => [...new Set(levels.flatMap((level: any) => level.allowed_grades ?? []))], [levels]);

  const copyTwibbonLink = async () => {
    const link = String(competition?.twibbon_external_url ?? '');
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast('Tautan Twibbon berhasil disalin.', 'success');
    } catch {
      toast('Browser tidak mengizinkan salin otomatis. Salin tautan dari bagian Twibbon secara manual.', 'error');
    }
  };

  if (loading) return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
    <div className="h-64 animate-pulse rounded-3xl surface-elevated" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((value) => <div key={value} className="h-20 animate-pulse rounded-2xl surface-elevated" />)}</div>
    <Card className="space-y-3 p-6"><div className="h-5 w-2/3 animate-pulse rounded surface-elevated" /><div className="h-4 w-4/5 animate-pulse rounded surface-elevated" /></Card>
  </div>;

  if (!competition) return <div className="mx-auto max-w-xl p-6 md:p-10">
    <Card className="p-8 text-center sm:p-10">
      <Trophy size={38} className="mx-auto mb-3 text-fg-muted" />
      <h1 className="text-lg font-bold text-fg">Lomba tidak ditemukan</h1>
      <p className="mt-2 text-sm text-fg-muted">{error || 'Uji kompetensi ini tidak tersedia atau tautannya sudah berubah.'}</p>
      <Button variant="outline" className="mt-5" onClick={() => navigate(-1)}>Kembali</Button>
    </Card>
  </div>;

  const status = statusUi(String(competition.status));
  const description = String(competition.description || competition.short_description || 'Deskripsi lomba akan ditambahkan oleh penyelenggara.');

  return <div className="min-h-screen pb-12 surface-bg text-fg">
    <div className="sticky top-0 z-30 border-b border-border bg-card/90 px-3 py-3 backdrop-blur-xl sm:px-5">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <button onClick={() => navigate(-1)} aria-label="Kembali" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-fg-muted transition hover:bg-surface-elevated hover:text-fg"><ArrowLeft size={18}/></button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-fg sm:text-base">{competition.title}</h2>
          <p className="truncate text-xs text-fg-muted">{category}</p>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
      </div>
    </div>

    <main className="mx-auto max-w-6xl space-y-6 p-3 sm:p-5 lg:p-7">
      <section className="relative isolate flex min-h-[300px] overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 sm:min-h-[360px]">
        {competition.poster_url && <img src={competition.poster_url} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/95 via-slate-950/75 to-slate-950/30" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/15" />
        <div className="flex w-full flex-col justify-end p-5 sm:p-8 lg:max-w-3xl lg:p-10">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"><Trophy size={13} className="text-amber-300"/>{category}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white"><Users size={13}/>{Number(competition.participant_count ?? 0).toLocaleString('id-ID')} peserta</span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">{competition.title}</h1>
          <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-slate-200 sm:text-base">{description}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {grades.slice(0, 5).map((grade: any) => <span key={String(grade)} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">{LEVEL_LABELS[String(grade)] ?? String(grade)}</span>)}
            {grades.length > 5 && <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">+{grades.length - 5} jenjang</span>}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Users size={18}/>} label="Peserta terdaftar" value={competition.participant_count ?? 0}/>
        <Stat icon={<Trophy size={18}/>} label="Soal tersedia" value={detail?.questionCount ?? 0}/>
        <Stat icon={<CalendarDays size={18}/>} label="Mulai lomba" value={formatShortDate(competition.starts_at)}/>
        <Stat icon={<ShieldCheck size={18}/>} label="Sistem persetujuan" value={rules?.approval_mode === 'AUTO' ? 'Otomatis' : 'Ditinjau panitia'}/>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Sparkles size={19}/></div>
              <div><h2 className="text-lg font-bold text-fg">Tentang lomba</h2><p className="text-xs text-fg-muted">Informasi dan jadwal resmi</p></div>
            </div>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-fg-secondary">{description}</p>
            {competition.juknis_url && <a href={competition.juknis_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-fg transition hover:border-accent/50 hover:text-accent"><FileText size={16}/> Baca petunjuk teknis</a>}
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><CalendarDays size={19}/></div>
              <div><h2 className="text-lg font-bold text-fg">Jadwal penting</h2><p className="text-xs text-fg-muted">Gunakan waktu yang ditampilkan sebagai acuan</p></div>
            </div>
            <div className="space-y-0">
              <TimelineItem label="Pendaftaran dibuka" value={competition.registration_starts_at} />
              <TimelineItem label="Batas akhir pendaftaran" value={competition.registration_ends_at} />
              <TimelineItem label="Uji kompetensi dimulai" value={competition.starts_at} />
              <TimelineItem label="Uji kompetensi berakhir" value={competition.ends_at} />
              <TimelineItem label="Pengumuman hasil" value={competition.announcement_at} last />
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><ShieldCheck size={19}/></div>
              <div><h2 className="text-lg font-bold text-fg">Syarat peserta</h2><p className="text-xs text-fg-muted">Periksa sebelum mengirim pendaftaran</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {grades.length ? grades.map((grade: any) => <span key={String(grade)} className="rounded-full border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent">{LEVEL_LABELS[String(grade)] ?? String(grade)}</span>) : <span className="text-sm text-fg-muted">Tidak ada pembatasan jenjang yang ditampilkan.</span>}
            </div>
            {rules && <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Rule label="Persetujuan pendaftaran" value={rules.approval_mode === 'AUTO' ? 'Otomatis' : 'Ditinjau panitia'} />
              <Rule label="Kuota peserta" value={rules.max_participants ? Number(rules.max_participants).toLocaleString('id-ID') + ' peserta' : 'Tidak dibatasi'} />
              <Rule label="Twibbon" value={rules.require_twibbon ? 'Wajib' : 'Opsional'} />
              <Rule label="Bukti media sosial" value={rules.require_social_proof ? 'Wajib' : 'Opsional'} />
            </div>}
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><Medal size={19}/></div>
              <div><h2 className="text-lg font-bold text-fg">Hadiah & apresiasi</h2><p className="text-xs text-fg-muted">Penghargaan yang disiapkan penyelenggara</p></div>
            </div>
            {rewards.length ? <div className="grid gap-3 sm:grid-cols-2">
              {rewards.map((reward: any, index: number) => {
                const rank = String(reward.rank_code ?? '');
                const label = rank === 'FIRST' ? 'Juara 1' : rank === 'SECOND' ? 'Juara 2' : rank === 'THIRD' ? 'Juara 3' : rank === 'PARTICIPANT' ? 'Peserta' : reward.title;
                return <div key={reward.id} className="flex items-center gap-3 rounded-2xl border border-border p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 font-bold text-amber-500">{index < 3 ? index + 1 : <Medal size={18}/>}</div>
                  <div className="min-w-0 flex-1"><p className="font-semibold text-fg">{label || 'Penghargaan'}</p><p className="mt-1 text-xs text-fg-muted">{reward.emblem_name || 'Lencana digital'}{reward.certificate_enabled ? ' · Sertifikat' : ''}</p></div>
                  <span className="shrink-0 text-sm font-bold text-accent">+{Number(reward.points ?? 0).toLocaleString('id-ID')} XP</span>
                </div>;
              })}
            </div> : <p className="text-sm text-fg-muted">Detail hadiah belum dipublikasikan.</p>}
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><ImageIcon size={19}/></div>
              <div><h2 className="text-lg font-bold text-fg">Twibbon lomba</h2><p className="text-xs text-fg-muted">Ikuti panduan dari penyelenggara</p></div>
            </div>
            {twibbons.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">
              {twibbons.map((twibbon: any) => <div key={twibbon.id} className="overflow-hidden rounded-2xl border border-border">
                <img src={twibbon.image_url} alt={twibbon.name} loading="lazy" className="aspect-video w-full object-cover"/>
                <div className="flex items-center justify-between gap-2 p-3"><span className="text-sm font-semibold text-fg">{twibbon.name}</span>{twibbon.is_required && <Badge color="moss">Wajib</Badge>}</div>
              </div>)}
            </div> : competition.twibbon_external_url ? <div className="rounded-2xl border border-border bg-surface-elevated/20 p-4">
              <p className="text-sm leading-relaxed text-fg-secondary">Penyelenggara menggunakan Twibbon eksternal. Salin tautannya dari popup pendaftaran untuk tetap berada di halaman lomba.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input className="input min-w-0 flex-1 text-xs" aria-label="Tautan Twibbon eksternal" value={String(competition.twibbon_external_url)} readOnly onFocus={(event) => event.currentTarget.select()}/>
                <Button variant="outline" onClick={() => void copyTwibbonLink()} icon={<Clipboard size={15}/>}>Salin tautan</Button>
              </div>
            </div> : <p className="text-sm text-fg-muted">Informasi Twibbon belum tersedia.</p>}
          </Card>

          {postId ? <Card className="p-5 sm:p-6"><CommentsSection postId={postId}/></Card> : <Card className="p-4"><p className="text-xs text-fg-muted">Kolom komentar akan tersedia setelah postingan lomba dibuat.</p></Card>}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <Card className="overflow-hidden p-0">
            <div className="bg-gradient-to-br from-accent/15 via-card to-card p-5 sm:p-6">
              <div className="flex items-center gap-2"><span className={'h-2.5 w-2.5 rounded-full ' + (joinable ? 'animate-pulse bg-emerald-500' : competition.status === 'LIVE' ? 'bg-amber-500' : 'bg-fg-muted')}/><p className="text-sm font-semibold text-fg">{status.label}</p></div>
              {joinable ? <>
                <h2 className="mt-4 text-xl font-bold text-fg">Siap ikut NCCS?</h2>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">Lengkapi syarat dan kirim pendaftaran langsung dari popup ini.</p>
                <div className="mt-4"><p className="mb-2 text-xs font-medium text-fg-muted">Waktu tersisa untuk mendaftar</p><CountdownCard cd={cd}/></div>
                <Button className="mt-5 w-full" size="lg" onClick={() => setRegistrationOpen(true)} icon={<Trophy size={17}/>}>{isGuest || !user ? 'Masuk untuk daftar' : 'Daftar sekarang'}</Button>
              </> : competition.status === 'LIVE' && Number(detail?.questionCount ?? 0) > 0 ? <>
                <h2 className="mt-4 text-xl font-bold text-fg">Ujian sedang berlangsung</h2>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">Jika sudah terdaftar dan mendapat akses, lanjutkan ke ruang ujian.</p>
                <Button className="mt-5 w-full" onClick={() => navigate('/lomba/' + competition.slug + '/kerja')} disabled={!user || isGuest}>Kerjakan uji kompetensi</Button>
              </> : <>
                <h2 className="mt-4 text-lg font-bold text-fg">{competition.status === 'REGISTRATION_CLOSED' ? 'Pendaftaran ditutup' : competition.status === 'RESULT_PUBLISHED' || competition.status === 'ARCHIVED' ? 'Lomba telah selesai' : 'Siapkan dirimu'}</h2>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{competition.status === 'PUBLISHED' ? 'Pendaftaran akan tersedia sesuai jadwal yang ditetapkan penyelenggara.' : 'Lihat jadwal dan ketentuan lomba untuk informasi selanjutnya.'}</p>
              </>}
            </div>
            <div className="space-y-3 border-t border-border p-5">
              <div className="flex items-start gap-3"><CalendarDays size={16} className="mt-0.5 shrink-0 text-accent"/><div><p className="text-xs text-fg-muted">Mulai lomba</p><p className="mt-0.5 text-sm font-semibold text-fg">{dateTime(competition.starts_at)}</p></div></div>
              <div className="flex items-start gap-3"><Clock3 size={16} className="mt-0.5 shrink-0 text-accent"/><div><p className="text-xs text-fg-muted">Batas pendaftaran</p><p className="mt-0.5 text-sm font-semibold text-fg">{dateTime(competition.registration_ends_at)}</p></div></div>
              {competition.juknis_url && <a href={competition.juknis_url} target="_blank" rel="noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-fg transition hover:border-accent/50 hover:text-accent"><FileText size={15}/> Petunjuk teknis</a>}
            </div>
          </Card>
          {joinable && <div className="flex items-start gap-3 rounded-2xl border border-accent/15 bg-accent/5 p-4">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent"/>
            <p className="text-xs leading-relaxed text-fg-muted">Pendaftaran terhubung dengan akun SykaBelajar. Statusnya dapat dipantau setelah formulir dikirim.</p>
          </div>}
        </aside>
      </div>
    </main>

    <CompetitionRegistrationModal
      open={registrationOpen}
      competition={competition}
      rules={rules}
      slug={slug}
      onClose={() => setRegistrationOpen(false)}
      onRegistered={() => { void refreshDetail(String(competition.id)); }}
    />
  </div>;
}

function Rule({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-surface-elevated/25 p-3.5">
    <p className="text-xs text-fg-muted">{label}</p>
    <p className="mt-1 text-sm font-semibold text-fg">{value}</p>
  </div>;
}

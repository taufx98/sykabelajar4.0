import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Clipboard, ExternalLink, FileCheck2,
  Loader2, ShieldCheck, Trophy, UserRound, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { submitRegistrationWithIntegrity } from '@/services/registration.service';
import { supabase } from '@/lib/supabase';

type RegistrationStep = 1 | 2 | 3;
type Props = {
  open: boolean;
  competition: any;
  rules?: any;
  slug: string;
  onClose: () => void;
  onRegistered?: () => void;
};

function registrationErrorMessage(message: string) {
  const messages: Record<string, string> = {
    REGISTRATION_NOT_OPEN: 'Pendaftaran belum dibuka atau sudah ditutup.',
    REGISTRATION_CLOSED: 'Pendaftaran lomba ini sudah ditutup.',
    ALREADY_REGISTERED: 'Akun ini sudah terdaftar pada lomba tersebut.',
    ELIGIBILITY_FAILED: 'Jenjang pada profilmu belum sesuai dengan syarat lomba.',
    PARTICIPANT_LIMIT_REACHED: 'Kuota peserta telah terpenuhi.',
    TWIBBON_REQUIRED: 'Selesaikan Twibbon terlebih dahulu, lalu centang konfirmasi Twibbon.',
    SOCIAL_PROOF_REQUIRED: 'Link postingan dan username media sosial wajib diisi untuk lomba ini.',
    AUTHORIZATION_REQUIRED: 'Sesi login berakhir. Silakan masuk kembali.',
    PROFILE_GRADE_REQUIRED: 'Lengkapi jenjang sekolah di profil sebelum mendaftar.',
    INTEGRITY_AGREEMENT_REQUIRED: 'Setujui Pakta Integritas sebelum mengirim pendaftaran.',
    SOCIAL_PROOF_PLATFORM_MISMATCH: 'Platform pilihan tidak sesuai dengan alamat tautan yang dimasukkan.',
  };
  for (const [key, value] of Object.entries(messages)) {
    if (message.includes(key)) return value;
  }
  return message || 'Pendaftaran belum berhasil. Periksa isian dan coba lagi.';
}

function registrationStatusLabel(status: unknown) {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'APPROVED': return 'Disetujui';
    case 'REJECTED': return 'Perlu diperbaiki';
    case 'CANCELLED': return 'Dibatalkan';
    default: return 'Menunggu persetujuan';
  }
}

function isMatchingPostUrl(platform: 'instagram' | 'tiktok', raw: string) {
  if (!raw.trim()) return false;
  try {
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return platform === 'instagram'
      ? host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am'
      : host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Jadwal mengikuti ketentuan lomba';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  }).format(new Date(value)) + ' WIB';
}

export function CompetitionRegistrationModal({ open, competition, rules, slug, onClose, onRegistered }: Props) {
  const { user, isGuest, toast } = useApp();
  const [step, setStep] = useState<RegistrationStep>(1);
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('tiktok');
  const [socialUsername, setSocialUsername] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [twibbonDone, setTwibbonDone] = useState(false);
  const [integrityAgreed, setIntegrityAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [existingRegistration, setExistingRegistration] = useState<any>(null);
  const [registrationResult, setRegistrationResult] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);

  const requireTwibbon = Boolean(rules?.require_twibbon);
  const requireSocialProof = Boolean(rules?.require_social_proof);
  const externalTwibbonUrl = String(competition?.twibbon_external_url ?? '');
  const userDisplayName = user?.displayName || user?.username || 'Peserta';
  const registrationEnd = formatDateTime(competition?.registration_ends_at);
  const hasSocialInputs = Boolean(socialUsername.trim() || postUrl.trim());
  const socialInputsPaired = Boolean(socialUsername.trim()) === Boolean(postUrl.trim());
  const socialUrlValid = !postUrl.trim() || isMatchingPostUrl(platform, postUrl);
  const canContinueStepOne = (!requireTwibbon || twibbonDone)
    && (!requireSocialProof || (socialUsername.trim().length >= 2 && isMatchingPostUrl(platform, postUrl)))
    && (requireSocialProof || (!hasSocialInputs || (socialUsername.trim().length >= 2 && isMatchingPostUrl(platform, postUrl))))
    && socialInputsPaired && socialUrlValid;

  const progressWidth = useMemo(() => ({ 1: '33.333%', 2: '66.667%', 3: '100%' })[step], [step]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setStep(1);
    setPlatform('tiktok');
    setSocialUsername('');
    setPostUrl('');
    setTwibbonDone(false);
    setIntegrityAgreed(false);
    setSubmitting(false);
    setChecking(Boolean(user?.id && !isGuest));
    setExistingRegistration(null);
    setRegistrationResult(null);
    setSubmitted(false);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (user?.id && !isGuest && competition?.id) {
      void (async () => {
        try {
          const { data, error } = await supabase
            .from('registrations')
            .select('id,status,submitted_at,created_at,metadata')
            .eq('competition_id', String(competition.id))
            .eq('user_id', String(user.id))
            .neq('status', 'CANCELLED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          if (active) setExistingRegistration(data ?? null);
        } catch (error) {
          if (active) toast(error instanceof Error ? error.message : 'Gagal memeriksa pendaftaran.', 'error');
        } finally {
          if (active) setChecking(false);
        }
      })();
    } else {
      setChecking(false);
    }

    return () => {
      active = false;
      document.body.style.overflow = originalOverflow;
    };
  }, [open, competition?.id, user?.id, isGuest, toast]);

  if (!open || !competition) return null;

  const copyTwibbonLink = async () => {
    if (!externalTwibbonUrl) return;
    try {
      await navigator.clipboard.writeText(externalTwibbonUrl);
      toast('Tautan Twibbon berhasil disalin. Buka tautannya, lalu kembali ke popup ini.', 'success');
    } catch {
      toast('Gagal menyalin otomatis. Pilih tautan lalu salin secara manual.', 'error');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.id || isGuest) {
      toast('Masuk ke akun SykaBelajar sebelum mendaftar.', 'error');
      return;
    }
    if (!canContinueStepOne) {
      toast(requireTwibbon && !twibbonDone
        ? 'Selesaikan Twibbon dan centang konfirmasi terlebih dahulu.'
        : 'Periksa kembali username dan tautan postingan media sosial.', 'error');
      setStep(1);
      return;
    }
    if (!integrityAgreed) {
      toast('Persetujuan Pakta Integritas wajib dicentang.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitRegistrationWithIntegrity({
        competitionId: String(competition.id),
        userId: String(user.id),
        socialPlatform: platform,
        socialUsername,
        socialProofUrl: postUrl,
        twibbonCompleted: twibbonDone,
        integrityAgreed,
      });
      setRegistrationResult(result.record);
      setExistingRegistration(result.record);
      setSubmitted(true);
      setStep(3);
      onRegistered?.();
      toast('Pendaftaran berhasil dikirim ke penyelenggara.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast(registrationErrorMessage(message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const closeIfAllowed = () => { if (!submitting) onClose(); };
  const statusLabel = registrationStatusLabel(registrationResult?.status ?? existingRegistration?.status);
  const registrationCode = String(registrationResult?.id ?? existingRegistration?.id ?? '');
  const submittedAt = registrationResult?.submitted_at ?? registrationResult?.created_at ?? existingRegistration?.submitted_at ?? existingRegistration?.created_at;
  const activeStatus = ['ACTIVE', 'APPROVED'].includes(String(registrationResult?.status ?? '').toUpperCase());

  return <div
    className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-md sm:p-5"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) closeIfAllowed(); }}
  >
    <section role="dialog" aria-modal="true" aria-labelledby="registration-modal-title" className="relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
      <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-accent/15 via-surface-elevated/70 to-card px-5 py-5 sm:px-6">
        <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"><UserRound size={19}/></div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Formulir Peserta</p>
              <h2 id="registration-modal-title" className="mt-1 text-lg font-bold leading-snug text-fg sm:text-xl">Pendaftaran {competition.title}</h2>
              <p className="mt-1 text-xs text-fg-muted">Selesaikan 3 langkah berikut untuk mengirim pendaftaran.</p>
            </div>
          </div>
          <button type="button" onClick={closeIfAllowed} disabled={submitting} aria-label="Tutup popup pendaftaran" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card/75 text-fg-muted transition hover:text-fg disabled:opacity-50"><X size={17}/></button>
        </div>

        {!(existingRegistration && !submitted) && !checking && (user && !isGuest) && <>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-border/80"><div className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-500 transition-all duration-300" style={{ width: progressWidth }}/></div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] sm:text-[11px]">
            <p className={step === 1 ? 'font-bold text-accent' : 'text-fg-muted'}>1. Twibbon & Repost</p>
            <p className={'text-center ' + (step === 2 ? 'font-bold text-accent' : 'text-fg-muted')}>2. Pakta Integritas</p>
            <p className={'text-right ' + (step === 3 ? 'font-bold text-emerald-500' : 'text-fg-muted')}>3. Selesai</p>
          </div>
        </>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {checking && <div className="flex items-center justify-center gap-3 py-12 text-sm text-fg-muted"><Loader2 size={19} className="animate-spin text-accent"/>Memeriksa status pendaftaran…</div>}

        {!checking && (!user || isGuest) && <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><ShieldCheck size={27}/></div>
          <h3 className="mt-4 text-lg font-bold text-fg">Masuk untuk mendaftar</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">Pendaftaran dihubungkan dengan akun SykaBelajar agar status dan riwayat lombamu tersimpan.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to={'/login?redirect=' + encodeURIComponent('/lomba/' + slug)} onClick={onClose}><Button fullWidth>Masuk ke akun</Button></Link>
            <Link to={'/register?redirect=' + encodeURIComponent('/lomba/' + slug)} onClick={onClose}><Button variant="outline" fullWidth>Buat akun baru</Button></Link>
          </div>
        </div>}

        {!checking && user && !isGuest && existingRegistration && !submitted && <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 size={29}/></div>
          <h3 className="mt-4 text-lg font-bold text-fg">Kamu sudah terdaftar</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">Tidak perlu mengirim pendaftaran kedua kali. Status saat ini ditampilkan di bawah.</p>
          <div className="mt-5 rounded-2xl border border-border bg-surface-elevated/30 p-4 text-left">
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-fg-muted">Status pendaftaran</span><span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">{statusLabel}</span></div>
            <p className="mt-3 text-xs text-fg-muted">ID pendaftaran</p><p className="mt-1 break-all font-mono text-sm font-semibold text-fg">{String(existingRegistration.id).toUpperCase()}</p>
            {submittedAt && <p className="mt-2 text-xs text-fg-muted">Dikirim pada {formatDateTime(submittedAt)}</p>}
          </div>
          <Button className="mt-5 w-full sm:w-auto" onClick={onClose}>Selesai</Button>
        </div>}

        {!checking && user && !isGuest && submitted && registrationResult && <div className="py-3 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 ring-8 ring-emerald-500/5"><CheckCircle2 size={34}/></div>
          <h3 className="mt-5 text-xl font-extrabold text-fg">{activeStatus ? 'Pendaftaran disetujui' : 'Pendaftaran berhasil dikirim!'}</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">{activeStatus ? 'Pendaftaranmu sudah aktif. Periksa kembali jadwal uji kompetensi.' : 'Data pendaftaranmu sudah tersimpan dan akan ditinjau penyelenggara.'}</p>

          <div className="mt-6 rounded-2xl border border-border bg-surface-elevated/30 p-4 text-left">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3"><span className="text-xs text-fg-muted">Status</span><span className={'rounded-full px-2.5 py-1 text-[11px] font-bold ' + (activeStatus ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500')}>{statusLabel}</span></div>
            <div className="flex items-start justify-between gap-3 border-b border-border py-3"><span className="text-xs text-fg-muted">ID Registrasi</span><span className="break-all text-right font-mono text-xs font-bold text-accent">#{registrationCode.slice(0, 8).toUpperCase()}</span></div>
            <div className="flex items-start justify-between gap-3 border-b border-border py-3"><span className="text-xs text-fg-muted">Nama Peserta</span><span className="text-right text-sm font-semibold text-fg">{userDisplayName}</span></div>
            <div className="flex items-start justify-between gap-3 border-b border-border py-3"><span className="text-xs text-fg-muted">Jadwal Uji Kompetensi</span><span className="max-w-[65%] text-right text-xs font-semibold leading-relaxed text-fg">{formatDateTime(competition.starts_at)}</span></div>
            {submittedAt && <div className="flex items-start justify-between gap-3 pt-3"><span className="text-xs text-fg-muted">Waktu Pendaftaran</span><span className="text-right text-xs text-fg-muted">{formatDateTime(submittedAt)}</span></div>}
          </div>
          <Button className="mt-5 w-full" onClick={onClose}>Selesai & Tutup</Button>
        </div>}

        {!checking && user && !isGuest && !existingRegistration && step === 1 && <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent/5 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Trophy size={18}/></div>
            <div><h3 className="text-sm font-bold text-fg">Selesaikan syarat pendaftaran</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Ikuti ketentuan Twibbon dan bukti media sosial yang ditetapkan penyelenggara. Kamu tetap berada di halaman lomba ini.</p></div>
          </div>

          {(requireTwibbon || externalTwibbonUrl) && <section className="rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Trophy size={17}/></div>
                <div><h3 className="text-sm font-semibold text-fg">Twibbon resmi</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">{requireTwibbon ? 'Wajib diselesaikan sebelum pendaftaran dikirim.' : 'Opsional, kecuali ketentuan lomba menyatakan wajib.'}</p></div>
              </div>
              {requireTwibbon && <span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-500">Wajib</span>}
            </div>
            {externalTwibbonUrl ? <div className="mt-3 rounded-xl border border-border bg-surface-elevated/25 p-3">
              <p className="break-all text-xs leading-relaxed text-fg-secondary">{externalTwibbonUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={externalTwibbonUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white transition hover:opacity-90"><ExternalLink size={14}/>Buka Twibbonize</a>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyTwibbonLink()} icon={<Clipboard size={14}/>}>Salin tautan</Button>
              </div>
            </div> : <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-fg-muted">Tautan Twibbon belum ditambahkan penyelenggara. Jika wajib, hubungi panitia sebelum melanjutkan.</p>}
            {requireTwibbon && <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-elevated/20 p-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-current" checked={twibbonDone} onChange={(event) => setTwibbonDone(event.target.checked)}/>
              <span><span className="block text-sm font-medium text-fg">Saya sudah menyelesaikan Twibbon</span><span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">Centang setelah menggunakan template sesuai ketentuan lomba.</span></span>
            </label>}
          </section>}

          <section className="rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-fg">Bukti postingan media sosial</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">{requireSocialProof ? 'Masukkan username dan URL postingan yang dapat diperiksa panitia.' : 'Opsional bila kamu ingin melampirkan bukti posting.'}</p></div>{requireSocialProof && <span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-500">Wajib</span>}</div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPlatform('tiktok')} className={'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ' + (platform === 'tiktok' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-elevated/50')}>TikTok{platform === 'tiktok' && <Check size={14}/>}</button>
              <button type="button" onClick={() => setPlatform('instagram')} className={'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ' + (platform === 'instagram' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-elevated/50')}>Instagram{platform === 'instagram' && <Check size={14}/>}</button>
            </div>
            <label className="mt-3 block text-xs text-fg-muted">Username {requireSocialProof ? '(wajib)' : '(opsional)'}
              <div className="mt-1 flex items-center rounded-xl border border-border bg-surface-elevated/20 focus-within:border-accent">
                <span className="pl-3 text-xs text-fg-muted">@</span>
                <input className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm text-fg outline-none" value={socialUsername} onChange={(event) => setSocialUsername(event.target.value)} placeholder="username_kamu" autoComplete="nickname"/>
              </div>
            </label>
            <label className="mt-3 block text-xs text-fg-muted">Link postingan {requireSocialProof ? '(wajib)' : '(opsional)'}
              <input className="input mt-1 w-full" type="url" value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder={platform === 'tiktok' ? 'https://www.tiktok.com/…' : 'https://www.instagram.com/p/…'} autoComplete="url"/>
            </label>
            {postUrl.trim() && !socialUrlValid && <p className="mt-2 text-xs text-rose-500">Tautan tersebut tidak sesuai dengan platform {platform === 'tiktok' ? 'TikTok' : 'Instagram'}.</p>}
            {!socialInputsPaired && <p className="mt-2 text-xs text-rose-500">Username dan tautan posting harus diisi bersama-sama.</p>}
          </section>

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-elevated/20 p-3">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent"/>
            <p className="text-xs leading-relaxed text-fg-muted">Data pendaftaran mengikuti ketentuan penyelenggara dan akan diperiksa secara otomatis oleh sistem serta oleh panitia bila diperlukan.</p>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="button" disabled={!canContinueStepOne} onClick={() => setStep(2)} icon={<ArrowRight size={15}/>}>Lanjut ke Pakta Integritas</Button>
          </div>
        </div>}

        {!checking && user && !isGuest && !existingRegistration && step === 2 && <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400"><FileCheck2 size={18}/></div>
            <div><h3 className="text-sm font-bold text-fg">Pakta Integritas Peserta</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Mohon baca dan setujui komitmen berikut sebelum mengirim pendaftaran.</p></div>
          </div>
          <div className="space-y-3 rounded-2xl border border-border bg-surface-elevated/20 p-4 text-sm">
            <p className="font-semibold text-fg">Dengan mengikuti {competition.title}, saya menyatakan bahwa:</p>
            <ol className="list-decimal space-y-2.5 pl-5 text-xs leading-relaxed text-fg-secondary">
              <li>Saya akan mengerjakan ujian secara mandiri, jujur, dan sportif.</li>
              <li>Saya tidak akan meminta bantuan orang lain atau menggunakan alat bantu yang dilarang oleh aturan lomba.</li>
              <li>Saya akan menjaga kerahasiaan soal dan tidak menyebarkan materi ujian tanpa izin penyelenggara.</li>
              <li>Saya memahami bahwa pelanggaran dapat menyebabkan pembatalan hasil sesuai ketentuan penyelenggara.</li>
            </ol>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-4 transition hover:border-accent/50">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-current" checked={integrityAgreed} onChange={(event) => setIntegrityAgreed(event.target.checked)}/>
            <span><span className="block text-sm font-semibold text-fg">Saya menyetujui Pakta Integritas</span><span className="mt-1 block text-xs leading-relaxed text-fg-muted">Persetujuan ini akan dicatat bersama waktu pengiriman pendaftaran.</span></span>
          </label>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={submitting} icon={<ArrowLeft size={15}/>}>Kembali</Button>
            <form onSubmit={(event) => void handleSubmit(event)}>
              <Button type="submit" loading={submitting} disabled={!integrityAgreed || submitting} icon={<CheckCircle2 size={16}/>}>Setujui & Kirim Pendaftaran</Button>
            </form>
          </div>
        </div>}
      </div>

      {!checking && user && !isGuest && submitted && registrationResult && null}
    </section>
  </div>;
}

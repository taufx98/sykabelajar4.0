import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Clipboard, Loader2, ShieldCheck, Trophy, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { submitRegistration } from '@/services/registration.service';
import { supabase } from '@/lib/supabase';

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
  };
  for (const [key, value] of Object.entries(messages)) {
    if (message.includes(key)) return value;
  }
  return message || 'Pendaftaran belum berhasil. Periksa isian dan coba lagi.';
}

export function CompetitionRegistrationModal({ open, competition, rules, slug, onClose, onRegistered }: Props) {
  const { user, isGuest, toast } = useApp();
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [socialUsername, setSocialUsername] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [twibbonDone, setTwibbonDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [existingRegistration, setExistingRegistration] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);

  const requireTwibbon = Boolean(rules?.require_twibbon);
  const requireSocialProof = Boolean(rules?.require_social_proof);
  const externalTwibbonUrl = String(competition?.twibbon_external_url ?? '');
  const registrationEnd = competition?.registration_ends_at
    ? new Date(String(competition.registration_ends_at)).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
    : 'sesuai jadwal lomba';

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPlatform('instagram');
    setSocialUsername('');
    setPostUrl('');
    setTwibbonDone(false);
    setSubmitting(false);
    setChecking(Boolean(user?.id && !isGuest));
    setExistingRegistration(null);
    setSubmitted(false);

    if (!user?.id || isGuest || !competition?.id) {
      setChecking(false);
      return () => { active = false; };
    }

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('registrations')
          .select('id,status,submitted_at,created_at')
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

    return () => { active = false; };
  }, [open, competition?.id, user?.id, isGuest, toast]);

  if (!open || !competition) return null;

  const copyTwibbonLink = async () => {
    if (!externalTwibbonUrl) return;
    try {
      await navigator.clipboard.writeText(externalTwibbonUrl);
      toast('Tautan Twibbon berhasil disalin. Buka tautan secara terpisah, lalu kembali ke popup ini.', 'success');
    } catch {
      toast('Browser tidak mengizinkan salin otomatis. Salin tautan yang tampil di bawah secara manual.', 'error');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.id || isGuest) {
      toast('Masuk ke akun SykaBelajar sebelum mendaftar.', 'error');
      return;
    }
    if (requireTwibbon && !twibbonDone) {
      toast('Centang konfirmasi setelah menyelesaikan Twibbon.', 'error');
      return;
    }
    if (requireSocialProof && (!socialUsername.trim() || !postUrl.trim())) {
      toast('Isi username dan link postingan media sosial.', 'error');
      return;
    }
    if ((socialUsername.trim() && !postUrl.trim()) || (!socialUsername.trim() && postUrl.trim())) {
      toast('Username dan link postingan harus diisi bersama-sama.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitRegistration({
        competitionId: String(competition.id),
        userId: String(user.id),
        socialPlatform: platform,
        socialUsername,
        socialProofUrl: postUrl,
        twibbonCompleted: twibbonDone,
      });
      setExistingRegistration(result.record);
      setSubmitted(true);
      onRegistered?.();
      toast('Pendaftaran berhasil dikirim ke penyelenggara.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast(registrationErrorMessage(message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (status: unknown) => {
    switch (String(status ?? '').toUpperCase()) {
      case 'APPROVED':
      case 'ACTIVE': return 'Disetujui';
      case 'REJECTED': return 'Perlu diperbaiki';
      case 'CANCELLED': return 'Dibatalkan';
      default: return 'Menunggu persetujuan';
    }
  };

  return <div
    className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-5"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="competition-registration-title"
      className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
    >
      <div className="relative overflow-hidden bg-gradient-to-br from-accent/20 via-surface-elevated to-card px-5 py-5 sm:px-7 sm:py-6">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-accent/10 blur-2xl" />
        <button type="button" onClick={onClose} disabled={submitting} aria-label="Tutup popup pendaftaran" className="absolute right-4 top-4 z-10 rounded-xl border border-border bg-card/80 p-2 text-fg-muted transition hover:text-fg disabled:opacity-50">
          <X size={18} />
        </button>
        <div className="relative flex items-start gap-3 pr-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent"><Trophy size={25} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Pendaftaran Uji Kompetensi</p>
            <h2 id="competition-registration-title" className="mt-1 text-xl font-bold leading-tight text-fg sm:text-2xl">{competition.title}</h2>
            <p className="mt-1 text-xs text-fg-muted">Tutup pendaftaran: {registrationEnd}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
        {checking && <div className="flex items-center justify-center gap-3 py-12 text-sm text-fg-muted"><Loader2 size={19} className="animate-spin text-accent" />Memeriksa status pendaftaran…</div>}

        {!checking && (!user || isGuest) && <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><ShieldCheck size={27}/></div>
          <h3 className="mt-4 text-lg font-bold text-fg">Masuk untuk mendaftar</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">Pendaftaran akan terhubung ke akun SykaBelajar agar status dan riwayat lombamu tersimpan dengan benar.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to={'/login?redirect=' + encodeURIComponent('/lomba/' + slug)} onClick={onClose}><Button fullWidth>Masuk ke akun</Button></Link>
            <Link to={'/register?redirect=' + encodeURIComponent('/lomba/' + slug)} onClick={onClose}><Button variant="outline" fullWidth>Buat akun baru</Button></Link>
          </div>
        </div>}

        {!checking && user && !isGuest && existingRegistration && <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 size={29}/></div>
          <h3 className="mt-4 text-lg font-bold text-fg">{submitted ? 'Pendaftaran berhasil dikirim' : 'Kamu sudah terdaftar'}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">Status pendaftaranmu: <strong className="text-fg">{statusLabel(existingRegistration.status)}</strong>. Kamu tidak perlu mengirim pendaftaran kedua kali.</p>
          <div className="mt-5 rounded-2xl border border-border bg-surface-elevated/30 p-4 text-left">
            <p className="text-xs text-fg-muted">Status saat ini</p>
            <p className="mt-1 font-semibold text-fg">{statusLabel(existingRegistration.status)}</p>
            {existingRegistration.submitted_at && <p className="mt-1 text-xs text-fg-muted">Dikirim pada {new Date(existingRegistration.submitted_at).toLocaleString('id-ID')}</p>}
          </div>
          <Button className="mt-5 w-full sm:w-auto" onClick={onClose}>Selesai</Button>
        </div>}

        {!checking && user && !isGuest && !existingRegistration && <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
          <div className="rounded-2xl border border-border bg-surface-elevated/30 p-4">
            <p className="text-sm font-semibold text-fg">Sebelum mengirim pendaftaran</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">Pastikan nama dan jenjang di profil sudah benar. Penyelenggara akan memeriksa pendaftaran sesuai jadwal dan ketentuan lomba.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">Status setelah dikirim: Menunggu persetujuan</span>
              {rules?.max_participants && <span className="rounded-full border border-border px-3 py-1 text-xs text-fg-muted">Kuota {Number(rules.max_participants).toLocaleString('id-ID')} peserta</span>}
            </div>
          </div>

          {(requireTwibbon || externalTwibbonUrl) && <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Trophy size={19}/></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg">Twibbon lomba</h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{requireTwibbon ? 'Lomba ini mewajibkan Twibbon. Salin tautan di bawah, selesaikan Twibbon, lalu kembali ke popup ini.' : 'Twibbon tersedia jika kamu ingin menggunakannya.'}</p>
                {externalTwibbonUrl && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input readOnly aria-label="Tautan Twibbon" value={externalTwibbonUrl} className="input min-w-0 flex-1 text-xs" onFocus={(event) => event.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={() => void copyTwibbonLink()} icon={<Clipboard size={15}/>}>Salin tautan</Button>
                </div>}
                {requireTwibbon && <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-current" checked={twibbonDone} onChange={(event) => setTwibbonDone(event.target.checked)} />
                  <span><span className="block text-sm font-medium text-fg">Saya sudah menyelesaikan Twibbon</span><span className="mt-0.5 block text-xs text-fg-muted">Saya mengonfirmasi bahwa Twibbon telah digunakan sesuai ketentuan lomba.</span></span>
                </label>}
              </div>
            </div>
          </div>}

          <div>
            <h3 className="text-sm font-semibold text-fg">Bukti postingan</h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{requireSocialProof ? 'Lomba ini meminta bukti posting media sosial. Masukkan URL postingan yang bisa diperiksa penyelenggara.' : 'Bukti posting bersifat opsional kecuali diwajibkan di aturan lomba.'}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <label className="block text-xs text-fg-muted">Platform
                <select className="input mt-1 w-full" value={platform} onChange={(event) => setPlatform(event.target.value as 'instagram' | 'tiktok')}>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </label>
              <label className="block text-xs text-fg-muted">Username {requireSocialProof ? '(wajib)' : '(opsional)'}
                <input className="input mt-1 w-full" value={socialUsername} onChange={(event) => setSocialUsername(event.target.value)} placeholder="@username" autoComplete="nickname" />
              </label>
            </div>
            <label className="mt-3 block text-xs text-fg-muted">Link postingan {requireSocialProof ? '(wajib)' : '(opsional)'}
              <input className="input mt-1 w-full" type="url" value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://www.instagram.com/p/…" autoComplete="url" />
            </label>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border p-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent"/>
            <p className="text-xs leading-relaxed text-fg-muted">Dengan mengirim pendaftaran, kamu menyatakan informasi yang diberikan benar. Pendaftaran akan disimpan pada akunmu, dan penyelenggara dapat meninjau kelayakannya.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Batal</Button>
            <Button type="submit" loading={submitting} disabled={submitting || (requireTwibbon && !twibbonDone)} icon={<CheckCircle2 size={16}/>}>Kirim pendaftaran</Button>
          </div>
        </form>}
      </div>
    </section>
  </div>;
}

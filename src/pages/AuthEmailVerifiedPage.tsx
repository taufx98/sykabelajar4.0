import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, GraduationCap, MailCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getSession, isBetterAuthEnabled } from '@/services/auth.service';
import { getStagingBetterAuthClient } from '@/services/betterAuthApi.client';

type VerificationState = 'checking' | 'ready' | 'verified' | 'unavailable';
type VerificationLocationState = { email?: string };

export function AuthEmailVerifiedPage() {
  const location = useLocation();
  const routeEmail = (location.state as VerificationLocationState | null)?.email ?? '';
  const [state, setState] = useState<VerificationState>('checking');
  const [email, setEmail] = useState(routeEmail);
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(Boolean(routeEmail));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [expiresAt, setExpiresAt] = useState(() => routeEmail ? Date.now() + 5 * 60_000 : 0);
  const [resendAvailableAt, setResendAvailableAt] = useState(() => routeEmail ? Date.now() + 2 * 60_000 : 0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const expirySeconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  const resendSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1_000));
  const formatCountdown = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    let live = true;
    if (!isBetterAuthEnabled()) {
      setState('unavailable');
      return () => { live = false; };
    }

    void getSession().then((session) => {
      if (!live) return;
      if (session?.user.emailVerified === true) {
        setEmail(session.user.email ?? routeEmail);
        setState('verified');
      } else {
        setState('ready');
      }
    }).catch(() => {
      if (live) setState('ready');
    });

    return () => { live = false; };
  }, [routeEmail]);

  const sendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Masukkan alamat email yang valid.');
      return;
    }
    setSending(true);
    setError('');
    setNotice('');
    try {
      await getStagingBetterAuthClient().sendVerificationOtp(normalizedEmail);
      setEmail(normalizedEmail);
      setOtp('');
      setSent(true);
      const sentAt = Date.now();
      setExpiresAt(sentAt + 5 * 60_000);
      setResendAvailableAt(sentAt + 2 * 60_000);
      setNotice('Kode verifikasi berhasil diminta. Periksa kotak masuk emailmu.');
    } catch {
      setError('Kode belum dapat dikirim. Periksa email dan coba lagi beberapa saat.');
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !/^\d{6}$/.test(otp.trim())) {
      setError('Masukkan email dan kode verifikasi 6 digit.');
      return;
    }
    setVerifying(true);
    setError('');
    setNotice('');
    try {
      if (expirySeconds <= 0) {
        setError('Kode sudah kedaluwarsa. Tunggu hingga bisa meminta kode baru.');
        return;
      }
      await getStagingBetterAuthClient().verifyEmailOtp(normalizedEmail, otp);
      setEmail(normalizedEmail);
      setState('verified');
      setNotice('Alamat email berhasil diverifikasi. Sesi login telah disiapkan.');
    } catch {
      setError('Kode salah, sudah kedaluwarsa, atau percobaan habis. Minta kode baru lalu coba lagi.');
    } finally {
      setVerifying(false);
    }
  };

  const verified = state === 'verified';
  const unavailable = state === 'unavailable';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 h-16 flex items-center justify-between border-b surface-border">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center">
            <GraduationCap size={16} className="text-white" />
          </div>
          <span className="font-display font-bold text-fg">sykabelajar<span className="text-accent">.id</span></span>
        </Link>
        <Link to="/login" className="text-sm text-slate-400 hover:text-fg-secondary">Kembali ke login</Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <section className="card w-full max-w-md p-6 md:p-8">
          <div className={'w-11 h-11 rounded-xl flex items-center justify-center mb-4 ' + (verified ? 'bg-moss-500/10 text-accent' : unavailable ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-400')}>
            {verified ? <CheckCircle2 size={20} /> : unavailable ? <AlertCircle size={20} /> : <MailCheck size={20} />}
          </div>
          <h1 className="font-display font-bold text-2xl text-fg mb-2">
            {verified ? 'Email berhasil diverifikasi' : unavailable ? 'Verifikasi kode hanya tersedia di staging Better Auth' : 'Verifikasi email'}
          </h1>

          {verified ? (
            <>
              <p className="text-sm text-slate-400 mb-6">
                Alamat email {email ? <strong className="text-fg">{email}</strong> : 'akunmu'} sudah terverifikasi.
              </p>
              <Button fullWidth size="lg" icon={<ArrowRight size={18} />} onClick={() => window.location.replace('/home')}>
                Lanjut ke SYKABELAJAR
              </Button>
            </>
          ) : unavailable ? (
            <>
              <p className="text-sm text-slate-400 mb-6">
                Halaman kode verifikasi ini hanya digunakan oleh autentikasi Better Auth staging.
              </p>
              <Link to="/login"><Button fullWidth size="lg">Kembali ke login</Button></Link>
            </>
          ) : state === 'checking' ? (
            <p className="text-sm text-slate-400">Memeriksa sesi dan status verifikasi email…</p>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-5">
                {sent
                  ? 'Masukkan kode 6 digit dari email. Kode berlaku 5 menit dan hanya dapat dicoba 3 kali.'
                  : 'Masukkan email akun untuk meminta kode verifikasi 6 digit.'}
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label" htmlFor="verification-email">Email</label>
                  <input
                    id="verification-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    className="input"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={verifying}
                    placeholder="nama@email.com"
                  />
                </div>
                {sent && (
                  <div>
                    <label className="label" htmlFor="verification-code">Kode verifikasi</label>
                    <p className="text-xs text-slate-400 mb-2" role="timer" aria-live="off">
                      {expirySeconds > 0
                        ? `Kode berlaku ${formatCountdown(expirySeconds)} lagi`
                        : 'Kode sudah kedaluwarsa'}
                    </p>
                    <input
                      id="verification-code"
                      name="verificationCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="input text-center tracking-[0.35em] text-lg font-semibold"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      onPaste={(event) => {
                        event.preventDefault();
                        setOtp(event.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6));
                      }}
                      disabled={verifying}
                      placeholder="000000"
                    />
                  </div>
                )}
                {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
                {notice && <p role="status" className="text-xs text-emerald-400">{notice}</p>}
                {sent && (
                  <Button fullWidth size="lg" loading={verifying} disabled={verifying || expirySeconds <= 0 || !/^\d{6}$/.test(otp)} onClick={() => void verifyCode()}>
                    Verifikasi kode
                  </Button>
                )}
                {sent && (
                  <p className="text-xs text-center text-slate-400" role="timer" aria-live="off">
                    {resendSeconds > 0
                      ? `Kirim ulang tersedia dalam ${formatCountdown(resendSeconds)}`
                      : 'Kamu sudah bisa meminta kode baru.'}
                  </p>
                )}
                <Button fullWidth size="sm" variant="outline" loading={sending} disabled={sending || verifying || !email.trim() || resendSeconds > 0} onClick={() => void sendCode()} icon={<RefreshCw size={14} />}>
                  {sent ? (resendSeconds > 0 ? `Kirim ulang (${formatCountdown(resendSeconds)})` : 'Kirim ulang kode') : 'Kirim kode verifikasi'}
                </Button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

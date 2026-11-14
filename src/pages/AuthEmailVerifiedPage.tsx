import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, GraduationCap, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getSession, isBetterAuthEnabled } from '@/services/auth.service';

type VerificationState = 'checking' | 'verified' | 'processed' | 'failed' | 'unavailable';

export function AuthEmailVerifiedPage() {
  const [state, setState] = useState<VerificationState>('checking');
  const [email, setEmail] = useState('');

  useEffect(() => {
    let live = true;
    const url = new URL(window.location.href);
    const callbackError = url.searchParams.has('error');

    // Callback query parameters are never treated as proof of verification.
    // The only success signal is the emailVerified field returned by Worker.
    url.searchParams.delete('error');
    url.searchParams.delete('status');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);

    if (!isBetterAuthEnabled()) {
      setState(callbackError ? 'failed' : 'unavailable');
      return () => { live = false; };
    }
    if (callbackError) {
      setState('failed');
      return () => { live = false; };
    }

    void getSession().then((session) => {
      if (!live) return;
      if (session?.user.emailVerified === true) {
        setEmail(session.user.email ?? '');
        setState('verified');
      } else {
        // Better Auth has processed the callback, but no verified session is
        // available in this browser. Let the user sign in or request a new link.
        setState('processed');
      }
    }).catch(() => {
      if (live) setState('unavailable');
    });

    return () => { live = false; };
  }, []);

  const verified = state === 'verified';
  const failed = state === 'failed';
  const title = verified
    ? 'Email berhasil diverifikasi'
    : failed
      ? 'Tautan verifikasi tidak dapat digunakan'
      : state === 'checking'
        ? 'Memeriksa verifikasi email'
        : 'Periksa status email akun';
  const message = verified
    ? 'Alamat email akun ' + email + ' sudah terverifikasi. Kamu dapat melanjutkan ke SYKABELAJAR.'
    : failed
      ? 'Tautan verifikasi tidak valid, sudah kedaluwarsa, atau dibatalkan. Masuk dan minta tautan verifikasi baru.'
      : state === 'checking'
        ? 'Kami sedang memeriksa status email langsung ke server.'
        : state === 'processed'
          ? 'Tautan sudah diproses. Masuk untuk melanjutkan. Jika akun masih meminta verifikasi, gunakan opsi kirim ulang tautan pada halaman login.'
          : 'Status verifikasi belum dapat dibaca di lingkungan ini. Coba masuk; jika verifikasi masih diperlukan, minta tautan baru.';

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
          <div className={'w-11 h-11 rounded-xl flex items-center justify-center mb-4 ' + (verified ? 'bg-moss-500/10 text-accent' : failed ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-400')}>
            {verified ? <CheckCircle2 size={20} /> : failed ? <AlertCircle size={20} /> : <MailCheck size={20} />}
          </div>
          <h1 className="font-display font-bold text-2xl text-fg mb-2">{title}</h1>
          <p className="text-sm text-slate-400 mb-6">{message}</p>
          <Link to={verified ? '/home' : '/login'}>
            <Button fullWidth size="lg" icon={<ArrowRight size={18} />}>
              {verified ? 'Lanjut ke SYKABELAJAR' : 'Kembali ke login'}
            </Button>
          </Link>
        </section>
      </main>
    </div>
  );
}

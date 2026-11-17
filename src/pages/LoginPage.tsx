import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck, Github } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { isBetterAuthEnabled, resetPassword, sendVerificationEmail, signInWithSocial } from '@/services/auth.service';
import { getStagingBetterAuthClient, type BetterAuthSocialProvider } from '@/services/betterAuthApi.client';
import { useLanguage } from '@/lib/LanguageContext';
import { resolveSafeInternalRedirect } from '@/lib/safeInternalRedirect.mjs';
import { getSocialAuthErrorCategory } from '@/services/betterAuthErrorCode.mjs';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRedirect = searchParams.get('redirect') || '/home';
  const redirectTo = resolveSafeInternalRedirect(requestedRedirect, window.location.origin);
  const registerTo = redirectTo === '/home' ? '/register' : `/register?redirect=${encodeURIComponent(redirectTo)}`;
  const { login, toast } = useApp();
  const { language } = useLanguage();
  const text = (id: string, en: string) => language === 'en' ? en : id;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [emailVerificationConfigured, setEmailVerificationConfigured] = useState<boolean | null>(null);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [socialProviders, setSocialProviders] = useState<BetterAuthSocialProvider[]>([]);
  const [socialLoading, setSocialLoading] = useState<BetterAuthSocialProvider | null>(null);
  const [unlinkedSocialProvider, setUnlinkedSocialProvider] = useState<'google' | 'github' | null>(null);
  const betterAuthPreview = isBetterAuthEnabled();

  useEffect(() => {
    if (!betterAuthPreview) return;
    let active = true;
    const client = getStagingBetterAuthClient();
    void Promise.all([
      client.getAvailableSocialProviders(),
      client.getEmailVerificationConfigured(),
      client.getEmailVerificationRequired(),
    ])
      .then(([providers, emailReady, verificationRequired]) => {
        if (!active) return;
        setSocialProviders(providers);
        setEmailVerificationConfigured(emailReady);
        setEmailVerificationRequired(verificationRequired);
      })
      .catch(() => {
        if (!active) return;
        setSocialProviders([]);
        setEmailVerificationConfigured(false);
        setEmailVerificationRequired(true);
      });
    return () => { active = false; };
  }, [betterAuthPreview]);

  // An unlinked OAuth identity is not created during login. Ask for explicit
  // consent first; only the confirmation action retries OAuth with requestSignUp.
  useEffect(() => {
    if (searchParams.get('oauthError') !== '1') return;
    const category = getSocialAuthErrorCategory(searchParams.get('error'));
    const provider = searchParams.get('provider');
    const intent = searchParams.get('intent');

    if (
      category === 'account_not_linked' &&
      intent !== 'signup' &&
      (provider === 'google' || provider === 'github')
    ) {
      setUnlinkedSocialProvider(provider);
    } else {
      const message = category === 'account_not_linked'
        ? language === 'en'
          ? 'No SYKABELAJAR account is connected to this social account. Sign in with the method you used originally, or start registration from the sign-up page.'
          : 'Belum ada akun SYKABELAJAR yang terhubung dengan akun sosial ini. Masuk dengan metode yang sebelumnya digunakan, atau mulai pendaftaran dari halaman Daftar.'
        : category === 'cancelled'
          ? language === 'en'
            ? 'Social sign-in was cancelled. You can try again or use email and password.'
            : 'Proses login sosial dibatalkan. Kamu bisa mencoba lagi atau masuk dengan email dan password.'
          : language === 'en'
            ? 'Google/GitHub sign-in could not be completed. Please try again or use email and password.'
            : 'Login Google/GitHub belum berhasil. Silakan coba lagi atau gunakan email dan password.';
      toast(message, 'error');
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('oauthError');
    nextParams.delete('error');
    nextParams.delete('error_description');
    nextParams.delete('provider');
    nextParams.delete('intent');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, toast, language]);

  const handleLogin = async () => {
    if (!email || !password) { toast(text('Isi email dan password','Enter your email and password'), 'error'); return; }
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.ok) {
        if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_NOT_VERIFIED|EMAIL_NOT_CONFIRMED/i.test(result.error ?? '')) {
          setNeedsEmailVerification(true);
          toast(betterAuthPreview
            ? text('Verifikasi email terlebih dahulu. Kami dapat mengirim ulang kode verifikasi.','Verify your email first. You can request another verification code.')
            : text('Verifikasi email terlebih dahulu. Kami dapat mengirim ulang tautan verifikasi.','Verify your email first. You can request another verification link.'), 'info');
          return;
        }
        if (/^AUTH_EMAIL_(DELIVERY_STATUS_UNKNOWN|DELIVERY_FAILED|ALL_PROVIDERS_EXHAUSTED|PROVIDER_QUOTA_REACHED|PROVIDER_CREDENTIAL_UNAVAILABLE|ENCRYPTION_KEY_NOT_CONFIGURED)$/.test(result.error ?? '')) {
          toast(text(
            'Layanan email verifikasi sedang bermasalah. Login akun yang belum terverifikasi belum dapat dilanjutkan. Periksa provider email dan coba lagi setelah pulih.',
            'Email verification delivery is currently unavailable. Unverified accounts cannot sign in until email delivery recovers.',
          ), 'error');
          return;
        }
        if (result.error === 'APPLICATION_IDENTITY_NOT_READY') {
          toast(text(
            'Identitas akun belum berhasil disinkronkan ke database staging. Coba lagi nanti atau hubungi admin.',
            'Your account identity could not be synchronized to the staging database. Try again later or contact an admin.',
          ), 'error');
          return;
        }
        toast(result.error || 'Login gagal', 'error');
        return;
      }
      setNeedsEmailVerification(false);
      toast(text('Selamat datang kembali!','Welcome back!'), 'success');
      navigate(redirectTo, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: BetterAuthSocialProvider) => {
    setSocialLoading(provider);
    const errorCallbackURL = `/login?oauthError=1&provider=${provider}&redirect=${encodeURIComponent(redirectTo)}`;
    try {
      // A login attempt deliberately does not request account creation.
      const result = await signInWithSocial(provider, redirectTo, { errorCallbackURL });
      if (!result.url) setSocialLoading(null);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_NOT_VERIFIED|EMAIL_NOT_CONFIRMED/i.test(code)) {
        setNeedsEmailVerification(true);
        toast(text('Email akun belum terverifikasi. Selesaikan verifikasi terlebih dahulu.','Your account email is not verified. Complete verification first.'), 'error');
      } else if (
        getSocialAuthErrorCategory(code) === 'account_not_linked' &&
        (provider === 'google' || provider === 'github')
      ) {
        setUnlinkedSocialProvider(provider);
      } else {
        toast(text('Login sosial belum berhasil. Coba lagi atau gunakan email dan password.','Social sign-in could not be completed. Try again or use email and password.'), 'error');
      }
      setSocialLoading(null);
    }
  };

  const handleContinueSocialSignup = async () => {
    const provider = unlinkedSocialProvider;
    if (!provider) return;

    setSocialLoading(provider);
    const callbackURL = `/auth/complete-profile?redirect=${encodeURIComponent(redirectTo)}`;
    const errorCallbackURL = `/login?oauthError=1&provider=${provider}&intent=signup&redirect=${encodeURIComponent(redirectTo)}`;
    try {
      const result = await signInWithSocial(provider, callbackURL, {
        requestSignUp: true,
        errorCallbackURL,
      });
      if (!result.url) setSocialLoading(null);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      const category = getSocialAuthErrorCategory(code);
      toast(category === 'cancelled'
        ? text('Pendaftaran sosial dibatalkan.','Social sign-up was cancelled.')
        : text('Pendaftaran akun sosial belum berhasil. Silakan coba lagi.','Social account registration could not be completed. Please try again.'), 'error');
      setSocialLoading(null);
    }
  };

  const providerLabel: Record<BetterAuthSocialProvider, string> = {
    google: 'Google / Gmail',
    github: 'GitHub',
    facebook: 'Facebook',
    twitter: 'X / Twitter',
  };

  const handleResendVerification = async () => {
    if (emailVerificationConfigured !== true) {
      toast(text(
        'Layanan pengiriman email verifikasi belum dikonfigurasi di staging. Akun tetap terkunci sampai email terverifikasi.',
        'The staging verification email service is not configured. The account stays locked until the email is verified.',
      ), 'info');
      return;
    }
    if (!email.trim()) {
      toast(text('Masukkan email akun terlebih dahulu.','Enter your account email first.'), 'error');
      return;
    }
    setVerificationLoading(true);
    try {
      await sendVerificationEmail(email.trim());
      if (betterAuthPreview) {
        navigate('/auth/verified', { state: { email: email.trim().toLowerCase() } });
      } else {
        toast(text(
          'Jika email tersebut memiliki akun yang belum diverifikasi, tautan verifikasi akan dikirim.',
          'If that address has an unverified account, a verification link will be sent.',
        ), 'success');
      }
    } catch (error: unknown) {
      // Do not claim delivery when the Worker/provider rejected the request.
      // BetterAuthClientError.message is a sanitized stable code; only expose
      // uppercase identifiers, never raw provider responses or credentials.
      const rawCode = error instanceof Error ? error.message : '';
      const safeCode = /^[A-Z0-9_]{2,80}$/.test(rawCode) ? rawCode : 'AUTH_REQUEST_FAILED';
      toast(text(
        'Kode verifikasi gagal diminta. Kode error: ' + safeCode,
        'Could not request a verification code. Error code: ' + safeCode,
      ), 'error');
    } finally {
      setVerificationLoading(false);
    }
  };

  const handleReset = async () => {
    if (!forgotEmail) { toast(text('Masukkan email terlebih dahulu','Enter your email first'), 'error'); return; }
    setResetLoading(true);
    try {
      await resetPassword(forgotEmail);
      toast(text('Link reset password berhasil dikirim.','Password reset link sent.'), 'success');
      setShowForgot(false);
    } catch (error: any) {
      toast(error?.message ?? text('Gagal mengirim link reset.','Could not send reset link.'), 'error');
    } finally {
      setResetLoading(false);
    }
  };


  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 h-16 flex items-center justify-between border-b surface-border">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center">
            <GraduationCap size={16} className="text-white" />
          </div>
          <span className="font-display font-bold text-fg">sykabelajar<span className="text-accent">.id</span></span>
        </Link>
        <Link to={registerTo} className="text-sm text-slate-400 hover:text-fg">
          {text('Belum punya akun?','Don’t have an account?')} <span className="text-accent">{text('Daftar','Sign up')}</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 md:py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-4 lg:gap-7 items-stretch">
          <section className="card order-1 p-6 md:p-8 flex flex-col justify-between lg:min-h-[520px]">
            <div>
              <div className="w-12 h-12 rounded-2xl gradient-moss flex items-center justify-center mb-6">
                <GraduationCap size={24} className="text-white" />
              </div>
              <h2 className="font-display font-bold text-2xl md:text-3xl leading-tight text-fg">
                {text('Belajar, berkompetisi, dan berkembang bersama.','Learn, compete, and grow together.')}
              </h2>
              <p className="text-sm leading-relaxed text-slate-400 mt-3 max-w-md">
                {text('Masuk ke SYKABELAJAR untuk mengikuti kompetisi, mengembangkan kemampuan, dan memantau perjalanan belajarmu.','Sign in to SYKABELAJAR to join competitions, build your skills, and follow your learning journey.')}
              </p>
            </div>

            <Link to="/peserta-kolektif/login" className="mt-8 flex items-center gap-3 rounded-xl border surface-border px-3.5 py-3.5 hover:border-moss-500/40 hover:bg-moss-500/5 transition">
              <span className="w-10 h-10 shrink-0 rounded-lg bg-moss-500/10 flex items-center justify-center text-accent">
                <ShieldCheck size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">{text('Masuk Peserta Kolektif','Group Participant Login')}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{text('Gunakan akun dan password portal dari Guru.','Use the portal account and password provided by your teacher.')}</span>
              </span>
              <ArrowRight size={16} className="text-slate-500 shrink-0" />
            </Link>
          </section>

          <section className="order-2 min-w-0">
            <div className="card p-6 md:p-8">
              <h1 className="font-display font-bold text-2xl text-fg mb-1">{text('Masuk','Sign in')}</h1>
              <p className="text-sm text-slate-400">
                {text('Gunakan email dan password akun SYKABELAJAR.','Use your SYKABELAJAR account email and password.')}
              </p>

              <div className="space-y-4 mt-6">
                <div>
                  <label className="label" htmlFor="login-email">Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input id="login-email" name="email" type="email" className="input pl-9" placeholder={text("nama@email.com","name@email.com")} value={email} onChange={(e) => { setEmail(e.target.value); setNeedsEmailVerification(false); }} autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="login-password">Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input id="login-password" name="password" type={showPassword ? "text" : "password"} className="input pl-9 pr-10" placeholder={text("Password","Password")} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleLogin()} autoComplete="current-password" />
                    <button type="button" aria-label={showPassword ? text("Sembunyikan password","Hide password") : text("Tampilkan password","Show password")} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-fg-secondary">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {needsEmailVerification && emailVerificationRequired && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-sm font-medium text-fg">{text('Email belum terverifikasi','Email not verified')}</p>
                <p className="mt-1 text-xs text-slate-500">{emailVerificationConfigured === false
                  ? text('Layanan pengiriman email verifikasi belum aktif di staging. Login tetap ditolak sampai email berhasil diverifikasi.','The staging verification email service is not active. Sign-in remains blocked until the email is verified.')
                  : betterAuthPreview
                    ? text('Periksa email untuk kode verifikasi 6 digit. Kode dapat dimasukkan di halaman verifikasi.','Check your inbox for a 6-digit verification code. Enter it on the verification page.')
                    : text('Periksa kotak masuk dan folder spam. Kamu dapat meminta tautan verifikasi dikirim kembali.','Check your inbox and spam folder. You can request another verification link.')}</p>
                <Button fullWidth size="sm" variant="outline" className="mt-3" loading={verificationLoading} disabled={verificationLoading || !email.trim() || emailVerificationConfigured !== true} onClick={() => void handleResendVerification()}>
                  {betterAuthPreview ? text('Kirim ulang kode verifikasi','Resend verification code') : text('Kirim ulang tautan verifikasi','Resend verification link')}
                </Button>
              </div>}

              <div className="flex justify-end mt-3">
                <button onClick={() => { setForgotEmail(email); setShowForgot(true); }} className="text-xs text-accent hover:underline">
                  {text('Lupa password?','Forgot password?')}
                </button>
              </div>
              <Button fullWidth size="lg" className="mt-5" loading={loading} onClick={() => void handleLogin()} icon={<ArrowRight size={18} />}>
                {text('Masuk','Sign in')}
              </Button>

              {betterAuthPreview && socialProviders.length > 0 && <div className="mt-6 pt-5 border-t surface-border">
                <div className="relative mb-4">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t surface-border" /></div>
                  <div className="relative flex justify-center"><span className="surface-bg px-3 text-xs text-slate-500">{text('atau masuk dengan','or continue with')}</span></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {socialProviders.map((provider) => <Button
                    key={provider}
                    type="button"
                    fullWidth
                    variant="outline"
                    loading={socialLoading === provider}
                    disabled={socialLoading !== null && socialLoading !== provider}
                    onClick={() => void handleSocialLogin(provider)}
                    className="justify-center"
                  >
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center shrink-0" aria-hidden="true">
                      {provider === 'google' ? (
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" focusable="false">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.05 5.05 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.05-3.71 1.05-2.86 0-5.28-1.93-6.15-4.53H2.16v2.87A11 11 0 0 0 12 23Z" />
                          <path fill="#FBBC05" d="M5.85 14.09A6.6 6.6 0 0 1 5.5 12c0-.72.12-1.42.35-2.09V7.04H2.16A11 11 0 0 0 1 12c0 1.78.43 3.46 1.16 4.96l3.69-2.87Z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.84 6.04l3.69 2.87C6.72 7.31 9.14 5.38 12 5.38Z" />
                        </svg>
                      ) : provider === 'github' ? (
                        <Github size={18} strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        <span className="text-[11px] font-bold">{provider === 'facebook' ? 'f' : 'X'}</span>
                      )}
                    </span>
                    {providerLabel[provider]}
                  </Button>)}
                </div>
                {emailVerificationRequired && socialProviders.includes('facebook') && <p className="mt-2 text-[11px] text-slate-500">{text('Facebook memerlukan verifikasi email SYKABELAJAR sebelum sesi dapat dibuat.','Facebook requires SYKABELAJAR email verification before a session can be created.')}</p>}
              </div>}
            </div>

            {showForgot && <div className="card p-4 mt-3 animate-slide-down">
              <p className="text-sm text-fg-secondary mb-2">{text('Reset password','Reset password')}</p>
              <p className="text-xs text-slate-500 mb-3">{betterAuthPreview ? text('Better Auth akan mengirim tautan pemulihan ke email akun.','Better Auth will send a recovery link to your account email.') : text('Supabase akan mengirim tautan reset password ke email akun.','Supabase will send a password reset link to your account email.')}</p>
              <label className="label" htmlFor="forgot-password-email">Email</label>
              <input id="forgot-password-email" name="forgotEmail" className="input mb-2" type="email" autoComplete="email" placeholder={text("Email kamu","Your email")} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" fullWidth size="sm" onClick={() => setShowForgot(false)}>{text('Batal','Cancel')}</Button>
                <Button fullWidth size="sm" loading={resetLoading} onClick={() => void handleReset()}>{text('Kirim Link Reset','Send reset link')}</Button>
              </div>
            </div>}
          </section>
        </div>
      </main>

      {unlinkedSocialProvider && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <section
            className="card w-full max-w-md p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlinked-social-title"
            aria-describedby="unlinked-social-description"
          >
            <h2 id="unlinked-social-title" className="font-display text-xl font-bold text-fg">
              {text('Akun belum terhubung','Account not connected')}
            </h2>
            <p id="unlinked-social-description" className="mt-3 text-sm leading-relaxed text-slate-400">
              {text(
                `Belum ada akun SYKABELAJAR yang terhubung dengan akun ${providerLabel[unlinkedSocialProvider]} ini. Apakah kamu ingin daftar baru?`,
                `No SYKABELAJAR account is connected to this ${providerLabel[unlinkedSocialProvider]} account. Would you like to create a new account?`,
              )}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {text(
                'Jika sudah punya akun, pilih Batal lalu masuk dengan email dan password yang digunakan saat mendaftar.',
                'If you already have an account, choose Cancel and sign in with the email and password you used when registering.',
              )}
            </p>
            <div className="mt-6 flex gap-2">
              <Button
                fullWidth
                variant="outline"
                autoFocus
                disabled={socialLoading !== null}
                onClick={() => setUnlinkedSocialProvider(null)}
              >
                {text('Batal','Cancel')}
              </Button>
              <Button
                fullWidth
                loading={socialLoading === unlinkedSocialProvider}
                disabled={socialLoading !== null && socialLoading !== unlinkedSocialProvider}
                onClick={() => void handleContinueSocialSignup()}
              >
                {text('Daftar baru','Create account')}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
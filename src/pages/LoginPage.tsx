import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { isBetterAuthEnabled, resetPassword, sendVerificationEmail, signInWithSocial } from '@/services/auth.service';
import { getStagingBetterAuthClient, type BetterAuthSocialProvider } from '@/services/betterAuthApi.client';
import { useLanguage } from '@/lib/LanguageContext';
import { resolveSafeInternalRedirect } from '@/lib/safeInternalRedirect.mjs';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [showPassword, setShowPassword] = useState(false);
  const [socialProviders, setSocialProviders] = useState<BetterAuthSocialProvider[]>([]);
  const [socialLoading, setSocialLoading] = useState<BetterAuthSocialProvider | null>(null);
  const betterAuthPreview = isBetterAuthEnabled();

  useEffect(() => {
    if (!betterAuthPreview) return;
    let active = true;
    const client = getStagingBetterAuthClient();
    void Promise.all([
      client.getAvailableSocialProviders(),
      client.getEmailVerificationConfigured(),
    ])
      .then(([providers, emailReady]) => {
        if (!active) return;
        setSocialProviders(providers);
        setEmailVerificationConfigured(emailReady);
      })
      .catch(() => {
        if (!active) return;
        setSocialProviders([]);
        setEmailVerificationConfigured(false);
      });
    return () => { active = false; };
  }, [betterAuthPreview]);

  const handleLogin = async () => {
    if (!email || !password) { toast(text('Isi email dan password','Enter your email and password'), 'error'); return; }
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.ok) {
        if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_NOT_VERIFIED|EMAIL_NOT_CONFIRMED/i.test(result.error ?? '')) {
          setNeedsEmailVerification(true);
          toast(text('Verifikasi email terlebih dahulu. Kami dapat mengirim ulang tautan verifikasi.','Verify your email first. You can request another verification link.'), 'info');
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
    try {
      await signInWithSocial(provider, redirectTo);
    } catch (error: any) {
      if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_NOT_VERIFIED|EMAIL_NOT_CONFIRMED/i.test(error?.message ?? '')) {
        setNeedsEmailVerification(true);
      }
      toast(error?.message ?? text('Login sosial gagal. Coba lagi.','Social sign-in failed. Please try again.'), 'error');
      setSocialLoading(null);
    }
  };

  const providerLabel: Record<BetterAuthSocialProvider, string> = {
    google: 'Google / Gmail',
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
      toast(text(
        'Jika email tersebut memiliki akun yang belum diverifikasi, tautan verifikasi akan dikirim.',
        'If that address has an unverified account, a verification link will be sent.',
      ), 'success');
    } catch {
      // Keep the response indistinguishable for unknown, verified and rate-limited addresses.
      toast(text(
        'Jika email tersebut memiliki akun yang belum diverifikasi, tautan verifikasi akan dikirim.',
        'If that address has an unverified account, a verification link will be sent.',
      ), 'success');
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
        <Link to="/" className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center"><GraduationCap size={16} className="text-white" /></div><span className="font-display font-bold text-fg">sykabelajar<span className="text-accent">.id</span></span></Link>
        <Link to={registerTo} className="text-sm text-slate-400 hover:text-fg">{text('Belum punya akun?','Don’t have an account?')} <span className="text-accent">{text('Daftar','Sign up')}</span></Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="card p-6 md:p-8 animate-slide-up">
            <h1 className="font-display font-bold text-2xl text-fg mb-1">{text('Masuk','Sign in')}</h1>
            <p className="text-sm text-slate-400 mb-6">{text('Masuk dengan email dan password. Sistem akan mengenali peran akun secara otomatis dari backend.','Sign in with your email and password. Your account role is detected automatically by the backend.')}</p>
            {betterAuthPreview && socialProviders.length > 0 && <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{text('Masuk dengan akun','Continue with')}</p>
              <div className="grid grid-cols-1 gap-2">
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
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">
                    {provider === 'google' ? 'G' : provider === 'facebook' ? 'f' : 'X'}
                  </span>
                  {text('Lanjutkan dengan ', 'Continue with ')}{providerLabel[provider]}
                </Button>)}
              </div>
              {socialProviders.includes('facebook') && <p className="mt-2 text-[11px] text-slate-500">{text('Facebook memerlukan verifikasi email SYKABELAJAR sebelum sesi dapat dibuat.','Facebook requires SYKABELAJAR email verification before a session can be created.')}</p>}
              <div className="relative my-5"><div className="absolute inset-0 flex items-center"><span className="w-full border-t surface-border"/></div><div className="relative flex justify-center"><span className="surface-bg px-3 text-xs text-slate-500">{text('atau masuk dengan email','or sign in with email')}</span></div></div>
            </div>}

            <Link to="/peserta-kolektif/login" className="mb-5 flex items-center gap-3 rounded-xl border surface-border px-3 py-3 hover:border-moss-500/40 hover:bg-moss-500/5 transition">
              <span className="w-9 h-9 rounded-lg bg-moss-500/10 flex items-center justify-center text-accent"><ShieldCheck size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{text('Masuk sebagai Peserta Kolektif','Sign in as a Group Participant')}</span><span className="block text-xs text-slate-500 mt-0.5">{text('Gunakan password portal dari Guru.','Use the portal password provided by your teacher.')}</span></span>
              <ArrowRight size={16} className="text-slate-500" />
            </Link>
            <div className="space-y-4">
              <div><label className="label">Email</label><div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type="email" className="input pl-9" placeholder={text("nama@email.com","name@email.com")} value={email} onChange={(e) => { setEmail(e.target.value); setNeedsEmailVerification(false); }} autoComplete="email" /></div></div>
              <div><label className="label">Password</label><div className="relative"><Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type={showPassword ? "text" : "password"} className="input pl-9 pr-10" placeholder={text("Password","Password")} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleLogin()} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-fg-secondary">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            </div>
            {needsEmailVerification && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-sm font-medium text-fg">{text('Email belum terverifikasi','Email not verified')}</p>
              <p className="mt-1 text-xs text-slate-500">{emailVerificationConfigured === false
                ? text('Layanan pengiriman email verifikasi belum aktif di staging. Login tetap ditolak sampai email berhasil diverifikasi.','The staging verification email service is not active. Sign-in remains blocked until the email is verified.')
                : text('Periksa kotak masuk dan folder spam. Kamu dapat meminta tautan verifikasi dikirim kembali.','Check your inbox and spam folder. You can request another verification link.')}</p>
              <Button fullWidth size="sm" variant="outline" className="mt-3" loading={verificationLoading} disabled={verificationLoading || !email.trim() || emailVerificationConfigured !== true} onClick={() => void handleResendVerification()}>{text('Kirim ulang tautan verifikasi','Resend verification link')}</Button>
            </div>}
            <div className="flex justify-end mt-3"><button onClick={() => { setForgotEmail(email); setShowForgot(true); }} className="text-xs text-accent hover:underline">{text('Lupa password?','Forgot password?')}</button></div>
            <Button fullWidth size="lg" className="mt-6" loading={loading} onClick={() => void handleLogin()} icon={<ArrowRight size={18} />}>Masuk</Button>
          </div>
          {showForgot && <div className="card p-4 mt-3 animate-slide-down"><p className="text-sm text-fg-secondary mb-2">{text('Reset password','Reset password')}</p><p className="text-xs text-slate-500 mb-3">{betterAuthPreview ? text('Better Auth akan mengirim tautan pemulihan ke email akun.','Better Auth will send a recovery link to your account email.') : text('Supabase akan mengirim tautan reset password ke email akun.','Supabase will send a password reset link to your account email.')}</p><input className="input mb-2" type="email" placeholder={text("Email kamu","Your email")} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} /><div className="flex gap-2"><Button variant="outline" fullWidth size="sm" onClick={() => setShowForgot(false)}>{text('Batal','Cancel')}</Button><Button fullWidth size="sm" loading={resetLoading} onClick={() => void handleReset()}>{text('Kirim Link Reset','Send reset link')}</Button></div></div>}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { resetPassword } from '@/services/auth.service';
import { useLanguage } from '@/lib/LanguageContext';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedRedirect = searchParams.get('redirect') || '/home';
  const redirectTo = requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//') ? requestedRedirect : '/home';
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
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { toast(text('Isi email dan password','Enter your email and password'), 'error'); return; }
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.ok) { toast(result.error || 'Login gagal', 'error'); return; }
      toast(text('Selamat datang kembali!','Welcome back!'), 'success');
      navigate(redirectTo, { replace: true });
    } finally {
      setLoading(false);
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
            <Link to="/peserta-kolektif/login" className="mb-5 flex items-center gap-3 rounded-xl border surface-border px-3 py-3 hover:border-moss-500/40 hover:bg-moss-500/5 transition">
              <span className="w-9 h-9 rounded-lg bg-moss-500/10 flex items-center justify-center text-accent"><ShieldCheck size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{text('Masuk sebagai Peserta Kolektif','Sign in as a Group Participant')}</span><span className="block text-xs text-slate-500 mt-0.5">{text('Gunakan password portal dari Guru.','Use the portal password provided by your teacher.')}</span></span>
              <ArrowRight size={16} className="text-slate-500" />
            </Link>
            <div className="space-y-4">
              <div><label className="label">Email</label><div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type="email" className="input pl-9" placeholder={text("nama@email.com","name@email.com")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div></div>
              <div><label className="label">Password</label><div className="relative"><Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type={showPassword ? "text" : "password"} className="input pl-9 pr-10" placeholder={text("Password","Password")} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleLogin()} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-fg-secondary">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            </div>
            <div className="flex justify-end mt-3"><button onClick={() => { setForgotEmail(email); setShowForgot(true); }} className="text-xs text-accent hover:underline">{text('Lupa password?','Forgot password?')}</button></div>
            <Button fullWidth size="lg" className="mt-6" loading={loading} onClick={() => void handleLogin()} icon={<ArrowRight size={18} />}>Masuk</Button>
          </div>
          {showForgot && <div className="card p-4 mt-3 animate-slide-down"><p className="text-sm text-fg-secondary mb-2">{text('Reset password','Reset password')}</p><p className="text-xs text-slate-500 mb-3">{text('Supabase akan mengirim tautan reset password ke email akun.','Supabase will send a password reset link to your account email.')}</p><input className="input mb-2" type="email" placeholder={text("Email kamu","Your email")} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} /><div className="flex gap-2"><Button variant="outline" fullWidth size="sm" onClick={() => setShowForgot(false)}>{text('Batal','Cancel')}</Button><Button fullWidth size="sm" loading={resetLoading} onClick={() => void handleReset()}>{text('Kirim Link Reset','Send reset link')}</Button></div></div>}
        </div>
      </div>
    </div>
  );
}

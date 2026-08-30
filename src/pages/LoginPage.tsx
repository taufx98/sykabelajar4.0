import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Mail, Lock, ArrowRight, UserRound, School, Building2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { resetPassword } from '@/services/auth.service';

type LoginRole = 'pelajar' | 'guru' | 'penyelenggara';

const ROLE_OPTIONS: { value: LoginRole; label: string; icon: typeof UserRound }[] = [
  { value: 'pelajar', label: 'Pelajar', icon: UserRound },
  { value: 'guru', label: 'Guru', icon: School },
  { value: 'penyelenggara', label: 'Penyelenggara', icon: Building2 },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login, toast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState<LoginRole>('pelajar');
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { toast('Isi email dan password', 'error'); return; }
    setLoading(true);
    try {
      const result = await login(email, password, requestedRole);
      if (!result.ok) { toast(result.error || 'Login gagal', 'error'); return; }
      toast('Selamat datang kembali!', 'success');
      navigate('/home');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!forgotEmail) { toast('Masukkan email terlebih dahulu', 'error'); return; }
    setResetLoading(true);
    try {
      await resetPassword(forgotEmail);
      toast('Link reset password berhasil dikirim.', 'success');
      setShowForgot(false);
    } catch (error: any) {
      toast(error?.message ?? 'Gagal mengirim link reset.', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 h-16 flex items-center justify-between border-b surface-border">
        <Link to="/" className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center"><GraduationCap size={16} className="text-white" /></div><span className="font-display font-bold text-fg">sykabelajar<span className="text-moss-400">.id</span></span></Link>
        <Link to="/register" className="text-sm text-slate-400 hover:text-fg">Belum punya akun? <span className="text-moss-400">Daftar</span></Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="card p-6 md:p-8 animate-slide-up">
            <h1 className="font-display font-bold text-2xl text-fg mb-1">Masuk</h1>
            <p className="text-sm text-slate-400 mb-6">Pilih jenis akun untuk verifikasi role dari backend.</p>
            <div className="mb-5">
              <label className="label">Masuk sebagai</label>
              <div className="grid grid-cols-3 gap-2">
                {ROLE_OPTIONS.map(({ value, label, icon: Icon }) => <button key={value} type="button" onClick={() => setRequestedRole(value)} className={`rounded-xl border p-3 flex flex-col items-center gap-2 transition ${requestedRole === value ? 'border-moss-500 bg-moss-500/10 text-moss-300' : 'surface-border text-slate-400 hover:surface-border'}`}><Icon size={18} /><span className="text-xs font-medium">{label}</span></button>)}
              </div>
            </div>
            <div className="space-y-4">
              <div><label className="label">Email</label><div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type="email" className="input pl-9" placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div></div>
              <div><label className="label">Password</label><div className="relative"><Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input type={showPassword ? "text" : "password"} className="input pl-9 pr-10" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleLogin()} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            </div>
            <div className="flex justify-end mt-3"><button onClick={() => { setForgotEmail(email); setShowForgot(true); }} className="text-xs text-moss-400 hover:underline">Lupa password?</button></div>
            <Button fullWidth size="lg" className="mt-6" loading={loading} onClick={() => void handleLogin()} icon={<ArrowRight size={18} />}>Masuk</Button>
          </div>
          {showForgot && <div className="card p-4 mt-3 animate-slide-down"><p className="text-sm text-slate-300 mb-2">Reset password</p><p className="text-xs text-slate-500 mb-3">Supabase akan mengirim tautan reset password ke email akun.</p><input className="input mb-2" type="email" placeholder="Email kamu" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} /><div className="flex gap-2"><Button variant="outline" fullWidth size="sm" onClick={() => setShowForgot(false)}>Batal</Button><Button fullWidth size="sm" loading={resetLoading} onClick={() => void handleReset()}>Kirim Link Reset</Button></div></div>}
        </div>
      </div>
    </div>
  );
}

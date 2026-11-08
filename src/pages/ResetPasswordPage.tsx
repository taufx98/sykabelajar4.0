import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, GraduationCap, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { completePasswordReset } from '@/services/auth.service';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { toast } = useApp();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [invalidLink, setInvalidLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return !params.get('token') || params.has('error');
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token') && !url.searchParams.has('error')) return;

    // Keep the single-use recovery token in component memory, not browser history.
    url.searchParams.delete('token');
    url.searchParams.delete('error');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  const handleReset = async () => {
    if (invalidLink || !token) {
      toast('Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.', 'error');
      return;
    }
    if (password.length < 8) {
      toast('Password baru minimal 8 karakter.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      toast('Konfirmasi password tidak cocok.', 'error');
      return;
    }

    setLoading(true);
    try {
      await completePasswordReset(token, password);
      setToken('');
      setInvalidLink(true);
      toast('Password berhasil diperbarui. Silakan masuk kembali.', 'success');
      navigate('/login', { replace: true });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const message = code.includes('INVALID_TOKEN') || code.includes('TOKEN_EXPIRED')
        ? 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.'
        : code === 'PASSWORD_RESET_INPUT_INVALID'
          ? 'Password baru minimal 8 karakter.'
          : 'Password belum dapat diperbarui. Minta tautan reset baru lalu coba lagi.';
      toast(message, 'error');
    } finally {
      setLoading(false);
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
        <Link to="/login" className="text-sm text-slate-400 hover:text-fg">Kembali ke login</Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <section className="card w-full max-w-md p-6 md:p-8">
          <div className="w-11 h-11 rounded-xl bg-moss-500/10 text-accent flex items-center justify-center mb-4">
            <Lock size={20} />
          </div>
          <h1 className="font-display font-bold text-2xl text-fg mb-2">Buat password baru</h1>
          {invalidLink ? (
            <>
              <p className="text-sm text-slate-400 mb-6">
                Tautan reset tidak tersedia, tidak valid, atau sudah kedaluwarsa. Minta tautan reset baru dari halaman login.
              </p>
              <Link to="/login"><Button fullWidth icon={<ArrowRight size={18} />}>Kembali ke login</Button></Link>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-6">
                Gunakan password minimal 8 karakter. Setelah berhasil, semua sesi lama akan dicabut dan kamu perlu masuk kembali.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label" htmlFor="new-password">Password baru</label>
                  <div className="relative">
                    <input
                      id="new-password"
                      className="input pr-10"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-fg-secondary" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="confirm-new-password">Konfirmasi password</label>
                  <div className="relative">
                    <input
                      id="confirm-new-password"
                      className="input pr-10"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-fg-secondary" aria-label={showConfirmPassword ? 'Sembunyikan konfirmasi password' : 'Tampilkan konfirmasi password'}>
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <Button fullWidth size="lg" loading={loading} disabled={loading || password.length < 8 || password !== confirmPassword} onClick={() => void handleReset()} icon={<ArrowRight size={18} />}>
                  Simpan password baru
                </Button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

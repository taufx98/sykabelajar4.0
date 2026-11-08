import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Copy, Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { isBetterAuthEnabled } from '@/services/auth.service';
import {
  getStagingBetterAuthClient,
  type BetterAuthLoginProviderSettings,
  type BetterAuthSocialProvider,
} from '@/services/betterAuthApi.client';

type ProviderDraft = {
  clientId: string;
  clientSecret: string;
  enabled: boolean;
};

const PROVIDER_ORDER: BetterAuthSocialProvider[] = ['google', 'facebook', 'twitter'];
const PROVIDER_LABEL: Record<BetterAuthSocialProvider, string> = {
  google: 'Google / Gmail',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
};
const PROVIDER_DESCRIPTION: Record<BetterAuthSocialProvider, string> = {
  google: 'Metode login utama. Gunakan Google OpenID Connect dengan scope openid, email, dan profile saja.',
  facebook: 'Metode opsional. Facebook tidak menyediakan klaim email terverifikasi yang konsisten, sehingga akun perlu melewati verifikasi email SYKABELAJAR.',
  twitter: 'Metode opsional. Aplikasi X harus mengizinkan akses email dan mengembalikan alamat email yang dikonfirmasi.',
};

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : 'SOCIAL_PROVIDER_REQUEST_FAILED';
  const known: Record<string, string> = {
    AUTH_SESSION_REQUIRED: 'Sesi Better Auth diperlukan. Masuk kembali melalui preview staging.',
    ADMIN_REQUIRED: 'Akun Better Auth ini belum memiliki role admin aktif di Supabase staging.',
    ADMIN_AUTH_UNAVAILABLE: 'Pemeriksaan admin staging tidak tersedia. Periksa provisioning staging dan role admin.',
    SOCIAL_PROVIDER_ENCRYPTION_NOT_CONFIGURED: 'Kunci AUTH_PROVIDER_ENCRYPTION_KEY belum dipasang sebagai Worker secret.',
    AUTH_PROVIDER_ENCRYPTION_KEY_NOT_CONFIGURED: 'Kunci enkripsi OAuth belum dipasang pada Worker.',
    SOCIAL_PROVIDER_PRIMARY_LOGIN_REQUIRED: 'Aktifkan Google sebagai metode login utama sebelum menyimpan provider opsional.',
    SOCIAL_PROVIDER_LAST_ENABLED_METHOD: 'Minimal satu metode login sosial harus tetap aktif.',
    SOCIAL_PROVIDER_CREDENTIAL_DECRYPT_FAILED: 'Secret tersimpan tidak dapat dibaca. Periksa kunci enkripsi Worker.',
  };
  return known[code] ?? code;
}

export function LoginProvidersSettingsPanel() {
  const previewEnabled = isBetterAuthEnabled();
  const [settings, setSettings] = useState<BetterAuthLoginProviderSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<BetterAuthSocialProvider, ProviderDraft>>({
    google: { clientId: '', clientSecret: '', enabled: true },
    facebook: { clientId: '', clientSecret: '', enabled: false },
    twitter: { clientId: '', clientSecret: '', enabled: false },
  });
  const [loading, setLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<BetterAuthSocialProvider | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Partial<Record<BetterAuthSocialProvider, boolean>>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [validation, setValidation] = useState<Partial<Record<BetterAuthSocialProvider, string>>>({});

  const applySettings = useCallback((value: BetterAuthLoginProviderSettings) => {
    setSettings(value);
    setDrafts((current) => {
      const next = { ...current };
      for (const provider of PROVIDER_ORDER) {
        const item = value.providers.find((entry) => entry.provider === provider);
        if (!item) continue;
        next[provider] = {
          clientId: item.clientId ?? '',
          clientSecret: '',
          enabled: item.enabled || (provider === 'google' && !item.secretConfigured),
        };
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!previewEnabled) return;
    setLoading(true);
    setError('');
    try {
      const value = await getStagingBetterAuthClient().getLoginProviderSettings();
      applySettings(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [applySettings, previewEnabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (provider: BetterAuthSocialProvider, patch: Partial<ProviderDraft>) => {
    setDrafts((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }));
  };

  const save = async (provider: BetterAuthSocialProvider) => {
    const draft = drafts[provider];
    if (!draft.clientId.trim()) {
      setError('Client ID wajib diisi.');
      return;
    }
    const existing = settings?.providers.find((entry) => entry.provider === provider);
    if (!draft.clientSecret.trim() && !existing?.secretConfigured) {
      setError('Client Secret wajib diisi saat pertama kali menyimpan provider.');
      return;
    }
    setBusyProvider(provider);
    setError('');
    setMessage('');
    try {
      const value = await getStagingBetterAuthClient().saveLoginProvider({
        provider,
        clientId: draft.clientId.trim(),
        ...(draft.clientSecret.trim() ? { clientSecret: draft.clientSecret.trim() } : {}),
        enabled: draft.enabled,
      });
      applySettings(value);
      setMessage(\`\${PROVIDER_LABEL[provider]} berhasil disimpan secara terenkripsi di D1.\`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyProvider(null);
    }
  };

  const toggle = async (provider: BetterAuthSocialProvider, enabled: boolean) => {
    const setting = settings?.providers.find((entry) => entry.provider === provider);
    if (!setting?.secretConfigured) {
      setError('Simpan Client ID dan Client Secret terlebih dahulu.');
      return;
    }
    if (!enabled && !window.confirm(\`Nonaktifkan \${PROVIDER_LABEL[provider]}? Pengguna tidak dapat memakai provider ini untuk login.\`)) {
      return;
    }
    setBusyProvider(provider);
    setError('');
    setMessage('');
    try {
      const value = await getStagingBetterAuthClient().setLoginProviderEnabled(provider, enabled);
      applySettings(value);
      setMessage(\`\${PROVIDER_LABEL[provider]} \${enabled ? 'diaktifkan' : 'dinonaktifkan'}. Konfigurasi Worker diperbarui tanpa redeploy.\`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyProvider(null);
    }
  };

  const validate = async (provider: BetterAuthSocialProvider) => {
    setBusyProvider(provider);
    setError('');
    setValidation((current) => ({ ...current, [provider]: '' }));
    try {
      const result = await getStagingBetterAuthClient().validateLoginProvider(provider);
      setValidation((current) => ({ ...current, [provider]: result.message }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyProvider(null);
    }
  };

  const copyCallback = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Callback URL berhasil disalin.');
    } catch {
      setError('Browser tidak mengizinkan penyalinan otomatis. Salin URL dari kolom callback.');
    }
  };

  if (!previewEnabled) {
    return <Card className="p-5">
      <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-accent"/><h3 className="font-semibold text-fg">Metode Login</h3><Badge>Staging only</Badge></div>
      <p className="mt-2 text-sm text-fg-muted">Pengaturan Google, Facebook, dan X hanya dapat dibuka dari preview Better Auth yang terhubung ke Supabase staging. Login produksi tetap menggunakan Supabase Auth sampai cutover Tahap 7.</p>
    </Card>;
  }

  const activeCount = settings?.providers.filter((provider) => provider.enabled).length ?? 0;

  return <Card className="p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-accent"/><h3 className="font-semibold text-fg">Metode Login</h3><Badge color="moss">Better Auth staging</Badge></div>
        <p className="mt-1 text-xs text-fg-muted">Kelola credential OAuth hanya di Worker. Client Secret tidak pernah ditampilkan kembali oleh API.</p>
      </div>
      <Button size="sm" variant="outline" icon={<RefreshCw size={13}/>} onClick={() => void load()} disabled={loading || busyProvider !== null}>Muat ulang</Button>
    </div>

    {settings && <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
      <Badge color={settings.encryptionKeyConfigured ? 'moss' : 'warn'}>{settings.encryptionKeyConfigured ? 'Kunci OAuth tersedia' : 'Kunci OAuth belum dipasang'}</Badge>
      <Badge>{activeCount} provider aktif</Badge>
      <Badge>Revision {settings.revision}</Badge>
    </div>}

    {error && <div role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
    {message && <div role="status" className="mt-4 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">{message}</div>}

    {!settings && loading && <p className="mt-5 text-sm text-fg-muted">Memuat pengaturan provider…</p>}
    {!settings && !loading && error && <div className="mt-4 rounded-xl border surface-border p-3 text-xs text-fg-muted">Panel ini memerlukan sesi Better Auth dan role admin aktif pada project Supabase staging. Karena akun dimulai dari nol, admin pertama perlu dibuat melalui bootstrap aman Tahap 6.</div>}

    {settings && <div className="mt-5 space-y-3">
      {PROVIDER_ORDER.map((provider) => {
        const setting = settings.providers.find((entry) => entry.provider === provider);
        const draft = drafts[provider];
        const active = Boolean(setting?.enabled);
        const secretConfigured = Boolean(setting?.secretConfigured);
        const busy = busyProvider === provider;
        const statusLabel = setting?.status === 'configured' ? 'Credential tersimpan' :
          setting?.status === 'encryption-key-required' ? 'Kunci enkripsi diperlukan' : 'Belum dikonfigurasi';
        return <section key={provider} className="rounded-xl border surface-border p-3 md:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-fg">{PROVIDER_LABEL[provider]}</h4>
                {provider === 'google' && <Badge color="moss">Utama</Badge>}
                <Badge color={active ? 'moss' : 'default'}>{active ? 'Aktif' : 'Nonaktif'}</Badge>
                {secretConfigured && <Badge>{statusLabel}</Badge>}
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">{PROVIDER_DESCRIPTION[provider]}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!secretConfigured || busy || !settings.encryptionKeyConfigured} onClick={() => void toggle(provider, !active)}>{active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold text-fg">Client ID</span>
              <input className="input w-full" autoComplete="off" spellCheck={false} value={draft.clientId} onChange={(event) => updateDraft(provider, { clientId: event.target.value })} placeholder="OAuth Client ID"/>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold text-fg">Client Secret <span className="font-normal text-fg-muted">(write-only)</span></span>
              <div className="relative">
                <input className="input w-full pr-10" type={visibleSecrets[provider] ? 'text' : 'password'} autoComplete="new-password" value={draft.clientSecret} onChange={(event) => updateDraft(provider, { clientSecret: event.target.value })} placeholder={secretConfigured ? 'Kosongkan untuk mempertahankan secret' : 'Masukkan OAuth Client Secret'}/>
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-label={visibleSecrets[provider] ? 'Sembunyikan secret' : 'Tampilkan secret sementara'} onClick={() => setVisibleSecrets((current) => ({ ...current, [provider]: !current[provider] }))}>{visibleSecrets[provider] ? <EyeOff size={15}/> : <Eye size={15}/>}</button>
              </div>
            </label>
          </div>

          <div className="mt-3">
            <label className="mb-1.5 block text-xs font-semibold text-fg">Callback URL (daftarkan persis di console provider)</label>
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1 text-[11px]" readOnly value={setting?.callbackUrl ?? ''}/>
              <Button size="sm" variant="outline" icon={<Copy size={13}/>} onClick={() => void copyCallback(setting?.callbackUrl ?? '')}>Salin</Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t surface-border pt-3">
            <div className="text-[11px] text-fg-muted">{provider === 'facebook' ? 'Login Facebook memerlukan verifikasi email SYKABELAJAR; alur email akan diaktifkan pada tahap akhir.' : provider === 'twitter' ? 'Login X hanya berhasil jika app mengembalikan email yang dikonfirmasi.' : 'Google menggunakan OpenID Connect; tidak meminta akses ke inbox Gmail.'}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy || !settings.encryptionKeyConfigured || !draft.clientId.trim() || (!draft.clientSecret.trim() && !secretConfigured)} loading={busy} onClick={() => void save(provider)}>Simpan</Button>
              <Button size="sm" variant="ghost" disabled={busy || !secretConfigured || !settings.encryptionKeyConfigured} onClick={() => void validate(provider)}>Validasi tersimpan</Button>
            </div>
          </div>
          {validation[provider] && <p className="mt-2 text-xs text-accent"><CheckCircle2 size={13} className="mr-1 inline"/> {validation[provider]}</p>}
        </section>;
      })}

      <section className="rounded-xl border border-dashed surface-border p-3">
        <div className="flex items-center gap-2"><CircleAlert size={15} className="text-fg-muted"/><h4 className="text-sm font-semibold text-fg">Instagram</h4><Badge>Unavailable</Badge></div>
        <p className="mt-1 text-xs text-fg-muted">{settings.instagram.reason} Tidak ada tombol aktivasi atau workaround.</p>
      </section>

      {!settings.encryptionKeyConfigured && <p className="text-xs text-amber-300">Sebelum menyimpan credential, tambahkan Worker secret <code>AUTH_PROVIDER_ENCRYPTION_KEY</code> melalui Cloudflare. Gunakan kunci acak minimal 32 karakter dan jangan kirim melalui chat atau masukkan ke frontend.</p>}
      <p className="text-[11px] text-fg-muted">Validasi tersimpan hanya memastikan Worker dapat mendekripsi credential. Tes login hosted tetap diperlukan untuk membuktikan konfigurasi pada Google/Facebook/X.</p>
    </div>}
  </Card>;
}

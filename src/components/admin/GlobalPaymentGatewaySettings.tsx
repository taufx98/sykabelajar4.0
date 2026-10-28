import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, CircleAlert, Copy, Eye, EyeOff, KeyRound, RefreshCw, Save, ShieldCheck, ToggleLeft, ToggleRight, Unplug, WalletCards, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import {
  getGlobalPaymentGatewaySettings,
  saveGlobalPaymentGatewaySettings,
  testGlobalPaymentGatewayConnection,
  type ActivePaymentProvider,
  type GatewayEnvironment,
  type GatewayEnvironmentInput,
  type GatewayProviderCode,
  type GatewayProviderInput,
  type GlobalPaymentGatewaySettings,
  type SaveGlobalPaymentGatewayInput,
} from '@/services/payment-gateway-settings.service';

type DraftEnv = GatewayEnvironmentInput & { clearCredentials: boolean };
type DraftProvider = {
  enabled: boolean;
  environment: GatewayEnvironment;
  environments: Record<GatewayEnvironment, DraftEnv>;
};
type DraftSettings = {
  activeProvider: ActivePaymentProvider;
  automaticPaymentsEnabled: boolean;
  providers: Record<GatewayProviderCode, DraftProvider>;
};

const ENVIRONMENTS: GatewayEnvironment[] = ['sandbox', 'production'];
const EMPTY_ENV: DraftEnv = {
  serverKey: '', clientKey: '', apiKey: '', apiSecret: '', webhookSecret: '',
  paymentMethod: 'VIRTUAL_ACCOUNT', paymentChannel: 'BCA.VA',
  returnUrl: 'https://sykabelajar.my.id/organizer/plan', clearCredentials: false,
};
const EMPTY_DRAFT: DraftSettings = {
  activeProvider: 'MIDTRANS',
  automaticPaymentsEnabled: true,
  providers: {
    MIDTRANS: { enabled: false, environment: 'sandbox', environments: { sandbox: { ...EMPTY_ENV }, production: { ...EMPTY_ENV } } },
    XENITHPAY: { enabled: false, environment: 'sandbox', environments: { sandbox: { ...EMPTY_ENV }, production: { ...EMPTY_ENV } } },
  },
};

function isGateway(value: ActivePaymentProvider): value is GatewayProviderCode {
  return value !== 'MANUAL';
}
function fromSettings(settings: GlobalPaymentGatewaySettings): DraftSettings {
  const providers = {} as DraftSettings['providers'];
  for (const provider of ['MIDTRANS', 'XENITHPAY'] as GatewayProviderCode[]) {
    const status = settings.providers[provider];
    const environments = {} as Record<GatewayEnvironment, DraftEnv>;
    for (const environment of ENVIRONMENTS) {
      const statusEnv = status.environments[environment];
      environments[environment] = {
        ...EMPTY_ENV,
        paymentMethod: statusEnv.paymentMethod || 'VIRTUAL_ACCOUNT',
        paymentChannel: statusEnv.paymentChannel || 'BCA.VA',
        returnUrl: statusEnv.returnUrl || EMPTY_ENV.returnUrl,
        clearCredentials: false,
      };
    }
    providers[provider] = {
      enabled: status.enabled,
      environment: status.environment,
      environments,
    };
  }
  return {
    activeProvider: settings.activeProvider,
    automaticPaymentsEnabled: settings.automaticPaymentsEnabled,
    providers,
  };
}
function toInput(draft: DraftSettings): SaveGlobalPaymentGatewayInput {
  const providers = {} as SaveGlobalPaymentGatewayInput['providers'];
  for (const provider of ['MIDTRANS', 'XENITHPAY'] as GatewayProviderCode[]) {
    const value = draft.providers[provider];
    providers[provider] = {
      enabled: value.enabled,
      environment: value.environment,
      environments: {
        sandbox: { ...value.environments.sandbox },
        production: { ...value.environments.production },
      },
    } as GatewayProviderInput;
  }
  return { activeProvider: draft.activeProvider, automaticPaymentsEnabled: draft.automaticPaymentsEnabled, providers };
}
function providerName(provider: ActivePaymentProvider) {
  if (provider === 'MIDTRANS') return 'Midtrans';
  if (provider === 'XENITHPAY') return 'XenithPay';
  return 'Manual / transfer rekening';
}
function fieldClass() {
  return 'input mt-1 w-full';
}

export function GlobalPaymentGatewaySettings() {
  const { toast } = useApp();
  const [settings, setSettings] = useState<GlobalPaymentGatewaySettings | null>(null);
  const [draft, setDraft] = useState<DraftSettings>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<GatewayProviderCode | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  async function loadSettings() {
    setLoading(true);
    try {
      const result = await getGlobalPaymentGatewaySettings();
      setSettings(result);
      setDraft(fromSettings(result));
    } catch (error: any) {
      toast(error?.message || 'Gagal memuat pengaturan payment gateway.', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadSettings(); }, []);

  const activeStatus = useMemo(() => {
    if (!settings || !isGateway(draft.activeProvider)) return null;
    return settings.providers[draft.activeProvider];
  }, [settings, draft.activeProvider]);

  function patchProvider(provider: GatewayProviderCode, patch: Partial<DraftProvider>) {
    setDraft((current) => ({ ...current, providers: { ...current.providers, [provider]: { ...current.providers[provider], ...patch } } }));
  }
  function patchEnv(provider: GatewayProviderCode, environment: GatewayEnvironment, patch: Partial<DraftEnv>) {
    setDraft((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          ...current.providers[provider],
          environments: {
            ...current.providers[provider].environments,
            [environment]: { ...current.providers[provider].environments[environment], ...patch },
          },
        },
      },
    }));
  }
  function secretField(provider: GatewayProviderCode, environment: GatewayEnvironment, key: keyof GatewayEnvironmentInput, label: string, configured: boolean) {
    const id = provider + '-' + environment + '-' + String(key);
    const value = draft.providers[provider].environments[environment][key] as string | undefined;
    const visible = Boolean(visibleSecrets[id]);
    return <label key={id} className="block text-xs font-medium text-fg-muted">
      {label}
      {configured && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">Tersimpan</span>}
      <span className="relative mt-1 block">
        <input className={fieldClass() + ' pr-11'} type={visible ? 'text' : 'password'} autoComplete="new-password" value={value ?? ''} disabled={draft.providers[provider].environments[environment].clearCredentials} onChange={(event) => patchEnv(provider, environment, { [key]: event.target.value } as Partial<DraftEnv>)} placeholder={configured ? 'Isi hanya jika ingin mengganti key' : 'Tempel credential dari dashboard provider'} />
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-fg-muted hover:bg-surface-elevated" onClick={() => setVisibleSecrets((current) => ({ ...current, [id]: !visible }))} aria-label={visible ? 'Sembunyikan credential' : 'Tampilkan credential'}>{visible ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
      </span>
    </label>;
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveGlobalPaymentGatewaySettings(toInput(draft));
      setSettings(result);
      setDraft(fromSettings(result));
      toast('Pengaturan gateway global berhasil disimpan.', 'success');
    } catch (error: any) {
      toast(error?.message || 'Gagal menyimpan pengaturan gateway.', 'error');
    } finally { setSaving(false); }
  }
  async function testConnection(provider: GatewayProviderCode) {
    const environment = draft.providers[provider].environment;
    setTesting(provider);
    try {
      const message = await testGlobalPaymentGatewayConnection(provider, environment, toInput(draft).providers);
      toast(message, 'success');
    } catch (error: any) {
      toast(error?.message || 'Uji koneksi gateway gagal.', 'error');
    } finally { setTesting(null); }
  }
  async function copyWebhookUrl() {
    const value = settings?.webhookUrl ?? '';
    if (!value) return;
    try { await navigator.clipboard.writeText(value); toast('URL webhook disalin.', 'success'); }
    catch { toast('Gagal menyalin URL. Silakan salin secara manual.', 'error'); }
  }

  if (loading) return <Card className="p-6"><div className="flex items-center gap-3 text-sm text-fg-muted"><RefreshCw size={16} className="animate-spin"/>Memuat konfigurasi gateway…</div></Card>;

  return <section className="space-y-5">
    <header className="rounded-3xl border border-accent/25 bg-gradient-to-br from-accent/10 via-surface-elevated/25 to-transparent p-5 md:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-accent"><WalletCards size={14}/> Payment center · Global</div>
          <h2 className="mt-2 text-2xl font-bold text-fg md:text-3xl">Payment Gateway Settings</h2>
          <p className="mt-2 text-sm leading-6 text-fg-muted">Satu konfigurasi untuk proses pembayaran otomatis SYKABELAJAR. Atur credential, sandbox/produksi, provider aktif, dan uji koneksi di sini. Pembayaran manual seperti rekening atau QRIS dikelola terpisah di halaman yang sama.</p>
        </div>
        <Button variant="outline" disabled={loading || saving} onClick={() => void loadSettings()} icon={<RefreshCw size={14}/>}>Muat ulang</Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-surface-border bg-surface/50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Provider aktif</p><p className="mt-1 font-bold text-fg">{providerName(settings?.activeProvider ?? draft.activeProvider)}</p><p className="mt-1 text-xs text-fg-muted">Ini pilihan utama yang digunakan oleh checkout otomatis.</p></div>
        <div className="rounded-2xl border border-surface-border bg-surface/50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Pembayaran otomatis</p><div className="mt-1 flex items-center gap-2">{settings?.automaticPaymentsEnabled ? <CheckCircle2 size={16} className="text-emerald-400"/> : <CircleAlert size={16} className="text-amber-300"/>}<p className="font-bold text-fg">{settings?.automaticPaymentsEnabled ? 'Diaktifkan' : 'Dinonaktifkan'}</p></div><p className="mt-1 text-xs text-fg-muted">Dapat dimatikan sementara tanpa menghapus konfigurasi.</p></div>
        <div className="rounded-2xl border border-surface-border bg-surface/50 p-4 sm:col-span-2 xl:col-span-1"><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Mode konfigurasi</p><p className="mt-1 font-bold text-fg">Sandbox / Production</p><p className="mt-1 text-xs text-fg-muted">Credential disimpan terpisah untuk setiap lingkungan.</p></div>
      </div>
    </header>

    <Card className="p-5 md:p-7">
      <div className="flex items-start gap-3 border-b border-surface-border pb-5"><div className="rounded-xl bg-accent/10 p-2.5 text-accent"><Zap size={19}/></div><div><h3 className="text-lg font-bold text-fg">Routing pembayaran global</h3><p className="mt-1 text-sm leading-5 text-fg-muted">Pilih provider otomatis yang digunakan seluruh fitur yang terintegrasi dengan layanan pembayaran pusat.</p></div></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block text-xs font-medium text-fg-muted">Provider utama<select className={fieldClass()} value={draft.activeProvider} onChange={(event) => setDraft((current) => ({ ...current, activeProvider: event.target.value as ActivePaymentProvider }))}><option value="MANUAL">Manual / transfer rekening</option><option value="MIDTRANS">Midtrans</option><option value="XENITHPAY">XenithPay</option></select></label>
        <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-elevated/25 p-4 text-left" onClick={() => setDraft((current) => ({ ...current, automaticPaymentsEnabled: !current.automaticPaymentsEnabled }))}><span><span className="block text-sm font-semibold text-fg">Pembayaran otomatis</span><span className="mt-1 block text-xs text-fg-muted">Matikan untuk menghentikan checkout otomatis sementara.</span></span>{draft.automaticPaymentsEnabled ? <ToggleRight size={28} className="shrink-0 text-emerald-400"/> : <ToggleLeft size={28} className="shrink-0 text-fg-muted"/>}</button>
      </div>
      {draft.activeProvider !== 'MANUAL' && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-fg-muted"><strong className="text-amber-200">Perhatian:</strong> provider utama hanya dapat diaktifkan untuk checkout otomatis apabila provider diaktifkan dan kredensial pada environment terpilih lengkap. Pesanan lama yang sudah dibuat tetap harus diselesaikan melalui provider awalnya.</div>}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-fg-muted">Pengaturan diterapkan secara global setelah disimpan.</p><Button loading={saving} disabled={saving} onClick={() => void save()} icon={<Save size={15}/>}>Simpan pengaturan global</Button></div>
    </Card>

    <div className="grid gap-5 xl:grid-cols-2">
      {(['MIDTRANS', 'XENITHPAY'] as GatewayProviderCode[]).map((provider) => {
        const config = draft.providers[provider];
        const status = settings?.providers[provider];
        const env = config.environment;
        const statusEnv = status?.environments[env];
        const enabled = config.enabled;
        return <Card key={provider} className="overflow-hidden p-5 md:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-surface-border pb-5">
            <div className="flex items-start gap-3"><div className="rounded-xl bg-accent/10 p-2.5 text-accent"><KeyRound size={18}/></div><div><h3 className="text-xl font-bold text-fg">{provider === 'MIDTRANS' ? 'Midtrans' : 'XenithPay'}</h3><p className="mt-1 text-xs leading-5 text-fg-muted">{provider === 'MIDTRANS' ? 'Snap checkout · Server Key dan Client Key' : 'Pay In API · API Key, API Secret, dan signature webhook'}</p></div></div>
            <button type="button" onClick={() => patchProvider(provider, { enabled: !enabled })} className={'inline-flex items-center gap-2 rounded-full px-3 py-2 text-[10px] font-bold ' + (enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-surface-elevated text-fg-muted')}><span className={'h-2 w-2 rounded-full ' + (enabled ? 'bg-emerald-400' : 'bg-fg-muted')}/>{enabled ? 'Aktif' : 'Nonaktif'}</button>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-fg-muted">Environment<select className={fieldClass()} value={env} onChange={(event) => patchProvider(provider, { environment: event.target.value as GatewayEnvironment })}><option value="sandbox">Sandbox (testing)</option><option value="production">Production (transaksi nyata)</option></select></label>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface-elevated/20 p-3"><span className="text-xs text-fg-muted">{statusEnv?.configured ? 'Credential untuk environment ini terdeteksi lengkap.' : 'Credential untuk environment ini belum terdeteksi lengkap.'}</span><Badge color={statusEnv?.configured ? 'moss' : 'warn'}>{statusEnv?.configured ? 'Terkonfigurasi' : 'Belum lengkap'}</Badge></div>
            {provider === 'MIDTRANS' ? <div className="space-y-4">
              {secretField(provider, env, 'serverKey', 'Server Key (rahasia)', Boolean(statusEnv?.serverKeyConfigured))}
              {secretField(provider, env, 'clientKey', 'Client Key (public key)', Boolean(statusEnv?.clientKeyConfigured))}
              <p className="text-[11px] leading-5 text-fg-muted">Server Key hanya dipakai di backend. Client Key dapat digunakan oleh checkout browser, tetapi tetap disimpan di konfigurasi server agar pengaturan tidak tersebar di banyak tempat.</p>
            </div> : <div className="space-y-4">
              {secretField(provider, env, 'apiKey', 'API Key', Boolean(statusEnv?.apiKeyConfigured))}
              {secretField(provider, env, 'apiSecret', 'API Secret (rahasia)', Boolean(statusEnv?.apiSecretConfigured))}
              {secretField(provider, env, 'webhookSecret', 'Webhook Signature Secret (rahasia)', Boolean(statusEnv?.webhookSecretConfigured))}
              <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-fg-muted">Payment Method<input className={fieldClass()} value={config.environments[env].paymentMethod ?? ''} onChange={(event) => patchEnv(provider, env, { paymentMethod: event.target.value })} placeholder="VIRTUAL_ACCOUNT"/></label><label className="block text-xs font-medium text-fg-muted">Payment Channel<input className={fieldClass()} value={config.environments[env].paymentChannel ?? ''} onChange={(event) => patchEnv(provider, env, { paymentChannel: event.target.value })} placeholder="BCA.VA"/></label></div>
              <label className="block text-xs font-medium text-fg-muted">URL kembali setelah pembayaran<input className={fieldClass()} type="url" value={config.environments[env].returnUrl ?? ''} onChange={(event) => patchEnv(provider, env, { returnUrl: event.target.value })} placeholder="https://sykabelajar.my.id/organizer/plan"/></label>
            </div>}
            <label className="flex items-start gap-3 rounded-xl border border-red-500/15 bg-red-500/5 p-3 text-xs text-fg-muted"><input className="mt-0.5" type="checkbox" checked={config.environments[env].clearCredentials} onChange={(event) => patchEnv(provider, env, { clearCredentials: event.target.checked })}/><span><strong className="block text-red-200">Hapus credential tersimpan pada environment ini</strong><span className="mt-1 block">Centang hanya jika ingin menghapus semua credential provider pada mode {env}. Ini tidak menghapus credential environment lainnya.</span></span></label>
            <div className="flex flex-col gap-2 border-t border-surface-border pt-4 sm:flex-row">
              <Button variant="outline" fullWidth disabled={testing !== null || saving} loading={testing === provider} onClick={() => void testConnection(provider)} icon={<Activity size={14}/>}>Uji koneksi {env}</Button>
              <Button fullWidth disabled={saving} onClick={() => void save()} icon={<Save size={14}/>}>Simpan konfigurasi</Button>
            </div>
          </div>
        </Card>;
      })}
    </div>

    <Card className="p-5 md:p-6">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-accent/10 p-2.5 text-accent"><ShieldCheck size={18}/></div><div className="min-w-0 flex-1"><h3 className="font-bold text-fg">Kunci dan webhook tetap aman</h3><p className="mt-1 text-sm leading-5 text-fg-muted">Credential tidak pernah ditampilkan kembali setelah tersimpan. Server Key, API Secret, dan Webhook Secret disimpan di tabel server-only yang hanya bisa dibaca backend. Masukkan nilai baru untuk mengganti key lama.</p></div></div>
      <div className="mt-4 rounded-xl border border-surface-border bg-surface-elevated/20 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold text-fg">URL webhook gateway</p><p className="mt-1 break-all font-mono text-[11px] text-fg-muted">{settings?.webhookUrl || 'Tersedia setelah Supabase URL terdeteksi'}</p></div><Button size="sm" variant="outline" disabled={!settings?.webhookUrl} onClick={() => void copyWebhookUrl()} icon={<Copy size={13}/>}>Salin URL</Button></div><p className="mt-2 text-[11px] leading-5 text-fg-muted">Daftarkan URL ini pada panel provider. Webhook baru akan berfungsi setelah fungsi penerima webhook tersedia dan dideploy pada Supabase.</p></div>
      {activeStatus && draft.automaticPaymentsEnabled && <div className="mt-3 flex items-start gap-2 text-xs text-fg-muted"><Unplug size={15} className="mt-0.5 shrink-0"/><p>Provider aktif: <strong className="text-fg">{providerName(draft.activeProvider)}</strong>. Status credential terbaru yang tersimpan: {activeStatus.environments[activeStatus.environment].configured ? 'lengkap' : 'belum lengkap'}.</p></div>}
    </Card>
  </section>;
}

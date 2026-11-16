import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Mail, Pencil, Plus, RefreshCw, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { getStagingAdminAccessToken } from '@/services/adminBetterAuthAccessToken';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type EmailProvider = 'sendpulse' | 'brevo' | 'mailjet' | 'mailtrap' | 'resend' | 'custom_http';
type CustomAuthMode = 'none' | 'bearer' | 'api_key' | 'basic';
type EmailAccount = {
  id: string;
  label: string;
  provider: EmailProvider;
  senderAddress: string;
  senderName: string;
  endpointUrl: string | null;
  authMode: string | null;
  credentialConfigured: boolean;
  enabled: boolean;
  priority: number;
  quotaHourLimit: number;
  quotaDayLimit: number;
  quotaMonthLimit: number;
  hourUsed: number;
  dayUsed: number;
  monthUsed: number;
  cooldownUntil: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};
type AccountDraft = {
  id: string | null;
  provider: EmailProvider;
  label: string;
  senderAddress: string;
  senderName: string;
  apiKey: string;
  apiSecret: string;
  endpointUrl: string;
  authMode: CustomAuthMode;
  authHeaderName: string;
  authPrefix: string;
  username: string;
  password: string;
  extraHeadersJson: string;
  payloadTemplateJson: string;
  quotaHourLimit: number;
  quotaDayLimit: number;
  quotaMonthLimit: number;
};
type SettingsResponse = {
  autoFailoverEnabled: boolean;
  accounts: EmailAccount[];
};

const QUOTAS: Record<EmailProvider, { hour: number; day: number; month: number }> = {
  sendpulse: { hour: 50, day: 400, month: 0 },
  brevo: { hour: 0, day: 300, month: 0 },
  mailjet: { hour: 0, day: 200, month: 6000 },
  mailtrap: { hour: 0, day: 150, month: 4000 },
  resend: { hour: 0, day: 100, month: 3000 },
  custom_http: { hour: 0, day: 0, month: 0 },
};
const PROVIDER_LABELS: Record<EmailProvider, string> = {
  sendpulse: 'SendPulse',
  brevo: 'Brevo',
  mailjet: 'Mailjet',
  mailtrap: 'Mailtrap Email Sending',
  resend: 'Resend',
  custom_http: 'Custom HTTP API',
};
const EMPTY_DRAFT: AccountDraft = {
  id: null, provider: 'sendpulse', label: '', senderAddress: '', senderName: 'SYKABELAJAR',
  apiKey: '', apiSecret: '', endpointUrl: '', authMode: 'bearer',
  authHeaderName: 'X-API-Key', authPrefix: '', username: '', password: '',
  extraHeadersJson: '', payloadTemplateJson: '',
  quotaHourLimit: QUOTAS.sendpulse.hour,
  quotaDayLimit: QUOTAS.sendpulse.day,
  quotaMonthLimit: QUOTAS.sendpulse.month,
};
const ERROR_LABELS: Record<string, string> = {
  AUTH_REQUIRED: 'Worker menolak token autentikasi Admin.',
  AUTH_RESOURCE_TOKEN_INVALID: 'Worker tidak dapat memverifikasi resource-token Better Auth.',
  AUTH_RESOURCE_TOKEN_HEADER_INVALID: 'Header token bukan format ES256/JWT yang diharapkan Worker.',
  AUTH_RESOURCE_TOKEN_FORMAT_INVALID: 'Format resource-token Better Auth tidak valid.',
  AUTH_RESOURCE_TOKEN_SIGNATURE_INVALID: 'Signature token tidak cocok dengan kunci publik JWKS Worker.',
  AUTH_RESOURCE_TOKEN_EXPIRED: 'Resource-token sudah kedaluwarsa. Muat ulang sesi staging.',
  AUTH_RESOURCE_TOKEN_CLAIMS_INVALID: 'Klaim issuer, audience, sub, role, atau masa berlaku token tidak sesuai.',
  AUTH_JWKS_KEY_NOT_FOUND: 'Kunci penandatangan token tidak ditemukan pada JWKS Worker.',
  AUTH_JWKS_KEY_AMBIGUOUS: 'JWKS Worker memiliki lebih dari satu kunci yang cocok untuk token.',
  AUTH_JWKS_UNAVAILABLE: 'Worker tidak dapat mengambil JWKS dari issuer Better Auth.',
  AUTH_JWKS_INVALID: 'Respons JWKS dari issuer Better Auth tidak valid.',
  AUTH_USERINFO_UNAVAILABLE: 'Endpoint UserInfo Better Auth tidak dapat dihubungi.',
  AUTH_USERINFO_INVALID: 'Identitas UserInfo tidak cocok atau email belum terverifikasi.',
  AUTH_SESSION_REQUIRED: 'Sesi Better Auth staging tidak ditemukan. Login ulang melalui staging.',
  AUTH_SESSION_EXPIRED: 'Sesi Better Auth staging sudah berakhir. Login ulang melalui staging.',
  AUTH_STAGING_APP_ORIGIN_REQUIRED: 'Buka pengaturan melalui https://staging.sykabelajar.my.id, bukan link preview Pages.',
  BETTER_AUTH_FRONTEND_DISABLED: 'Better Auth frontend staging belum aktif pada halaman ini.',
  ADMIN_REQUIRED: 'Hanya admin aktif yang dapat mengelola email.',
  ADMIN_AUTH_UNAVAILABLE: 'Layanan verifikasi admin sementara tidak tersedia.',
  INVALID_EMAIL_PROVIDER: 'Penyedia email tidak didukung.',
  EMAIL_PROVIDER_CREDENTIAL_REQUIRED: 'Kredensial penyedia wajib diisi.',
  EMAIL_PROVIDER_CREDENTIAL_REJECTED: 'Penyedia menolak kredensial. Periksa API key/token.',
  EMAIL_PROVIDER_QUOTA_REACHED: 'Kuota internal atau kuota provider telah tercapai.',
  EMAIL_DELIVERY_STATUS_UNKNOWN: 'Status pengiriman tidak dapat dipastikan. Email tidak dicoba ulang ke provider lain untuk menghindari duplikasi.',
  EMAIL_TEST_RATE_LIMITED: 'Tes email dibatasi satu kali per menit untuk setiap admin.',
  INVALID_EMAIL_QUOTA: 'Kuota harus berupa bilangan bulat 0 atau lebih. Isi 0 untuk tanpa batas internal.',
  INVALID_SENDER_ADDRESS: 'Alamat pengirim tidak valid.',
  EMAIL_CUSTOM_ENDPOINT_INVALID: 'Endpoint wajib HTTPS dan harus menggunakan hostname publik yang valid tanpa alamat IP, port khusus, atau URL lokal.',
  EMAIL_CUSTOM_AUTH_INVALID: 'Konfigurasi metode autentikasi atau nama header tidak valid.',
  EMAIL_CUSTOM_CREDENTIAL_REQUIRED: 'Kredensial untuk metode autentikasi yang dipilih wajib diisi.',
  EMAIL_CUSTOM_HEADERS_INVALID: 'Header tambahan harus berupa JSON valid dengan nama dan nilai header yang aman.',
  EMAIL_CUSTOM_PAYLOAD_INVALID: 'Template payload harus berupa JSON object dan menggunakan placeholder yang didukung.',
  EMAIL_ROUTING_CONFIGURATION_INVALID: 'Pengaturan urutan atau kuota tidak valid.',
};
const STAGING_PREVIEW_HOST = 'security-auth-poc-stage-1.sykabelajar4.pages.dev';
const STAGING_AUTH_WORKER_URL = 'https://auth.sykabelajar.my.id';

function authWorkerUrl() {
  const configured = String(import.meta.env.VITE_AUTH_WORKER_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location.hostname === STAGING_PREVIEW_HOST) return STAGING_AUTH_WORKER_URL;
  return '';
}
function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}
function usageText(used: number, limit: number) {
  return limit > 0 ? used.toLocaleString('id-ID') + ' / ' + limit.toLocaleString('id-ID') : used.toLocaleString('id-ID') + ' / tanpa batas';
}
function providerQuotaHint(provider: EmailProvider) {
  switch (provider) {
    case 'sendpulse': return 'Batas awal Free: 50 email/jam dan 400 email/hari. Kredensial: API Key statis SendPulse.';
    case 'brevo': return 'Batas awal Free: 300 email/hari. Kredensial: API Key v3 Brevo.';
    case 'mailjet': return 'Batas awal Free: 200 email/hari dan 6.000 email/bulan. Butuh Public API Key dan Private API Key.';
    case 'mailtrap': return 'Batas awal Free: 150 email/hari dan 4.000 email/bulan. Gunakan token Email Sending, bukan Email Sandbox.';
    case 'resend': return 'Batas awal Free: 100 email/hari dan 3.000 email/bulan. Kredensial: Resend API Key.';
    case 'custom_http': return 'Hubungkan layanan email apa pun yang menyediakan HTTPS JSON API. Siapkan endpoint, metode autentikasi, kredensial, header opsional, dan format payload JSON.';
  }
}
function quotaPercent(used: number, limit: number) {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

export function TransactionalEmailSettingsPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState(true);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = useMemo(() => authWorkerUrl(), []);

  const getAccessToken = useCallback(async () => {
    const token = await getStagingAdminAccessToken();
    return token;
  }, []);
  const request = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    if (!baseUrl) throw new Error('AUTH_WORKER_URL_NOT_CONFIGURED');
    let token: string;
    try {
      token = await getAccessToken();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'AUTH_REQUIRED';
      throw new Error(ERROR_LABELS[code] ?? 'Sesi Better Auth staging tidak tersedia (' + code + '). Login ulang melalui staging.');
    }
    const response = await fetch(baseUrl + '/api/admin/email-settings', {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify({ action, ...payload }) } : {}),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || result?.ok !== true) {
      const code = String(result?.error ?? 'EMAIL_SETTINGS_REQUEST_FAILED');
      throw new Error(ERROR_LABELS[code] ?? 'Pengaturan email gagal diproses (' + code + ').');
    }
    return result;
  }, [baseUrl, getAccessToken]);

  const applySettings = useCallback((value: unknown) => {
    const result = value as SettingsResponse;
    setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
    setAutoFailoverEnabled(result?.autoFailoverEnabled !== false);
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { applySettings(await request('get')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal memuat pengaturan email.'); }
    finally { setLoading(false); }
  }, [request, applySettings]);
  useEffect(() => { void load(); }, [load]);

  const startNew = () => { setDraft(EMPTY_DRAFT); setEditing(true); };
  const edit = (account: EmailAccount) => {
    setDraft({
      id: account.id, provider: account.provider, label: account.label,
      senderAddress: account.senderAddress, senderName: account.senderName,
      apiKey: '', apiSecret: '', endpointUrl: account.endpointUrl ?? '',
      authMode: (account.authMode as CustomAuthMode) || 'bearer',
      authHeaderName: '', authPrefix: '', username: '', password: '',
      extraHeadersJson: '', payloadTemplateJson: '',
      quotaHourLimit: account.quotaHourLimit,
      quotaDayLimit: account.quotaDayLimit, quotaMonthLimit: account.quotaMonthLimit,
    });
    setEditing(true);
  };
  const changeProvider = (provider: EmailProvider) => {
    setDraft((current) => ({
      ...current, provider, apiKey: '', apiSecret: '',
      quotaHourLimit: QUOTAS[provider].hour,
      quotaDayLimit: QUOTAS[provider].day,
      quotaMonthLimit: QUOTAS[provider].month,
    }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.label.trim() || !draft.senderAddress.trim()) {
      toast.warning('Nama profil dan alamat pengirim wajib diisi.'); return;
    }
    const existing = draft.id ? accounts.find((item) => item.id === draft.id) : undefined;
    const needsCredential = !existing || existing.provider !== draft.provider;
    const credentials: Record<string, string> = {};
    let customConfig: Record<string, string> | null = null;

    if (draft.provider === 'custom_http') {
      if (!draft.endpointUrl.trim()) { toast.warning('Endpoint HTTPS wajib diisi.'); return; }
      if ((draft.authMode === 'bearer' || draft.authMode === 'api_key') &&
          needsCredential && !draft.apiKey.trim()) {
        toast.warning('API key wajib diisi untuk metode autentikasi ini.'); return;
      }
      if (draft.authMode === 'basic' && needsCredential &&
          (!draft.username.trim() || !draft.password)) {
        toast.warning('Username dan password wajib diisi untuk Basic Auth.'); return;
      }
      customConfig = {
        endpointUrl: draft.endpointUrl.trim(),
        authMode: draft.authMode,
        authHeaderName: draft.authHeaderName.trim(),
        authPrefix: draft.authPrefix.trim(),
        extraHeadersJson: draft.extraHeadersJson.trim(),
        payloadTemplateJson: draft.payloadTemplateJson.trim(),
      };
      if (draft.apiKey.trim()) customConfig.apiKey = draft.apiKey.trim();
      if (draft.username.trim()) customConfig.username = draft.username.trim();
      if (draft.password) customConfig.password = draft.password;
    } else {
      if (needsCredential && (!draft.apiKey.trim() || (draft.provider === 'mailjet' && !draft.apiSecret.trim()))) {
        toast.warning('Kredensial penyedia wajib diisi.'); return;
      }
      if (draft.provider === 'mailjet' && !needsCredential &&
          (Boolean(draft.apiKey.trim()) !== Boolean(draft.apiSecret.trim()))) {
        toast.warning('Mailjet membutuhkan Public API Key dan Private API Key sekaligus.'); return;
      }
      if (draft.provider === 'mailjet') {
        if (draft.apiKey.trim()) credentials.apiKey = draft.apiKey.trim();
        if (draft.apiSecret.trim()) credentials.apiSecret = draft.apiSecret.trim();
      } else if (draft.provider === 'mailtrap') {
        if (draft.apiKey.trim()) credentials.apiToken = draft.apiKey.trim();
      } else if (draft.apiKey.trim()) credentials.apiKey = draft.apiKey.trim();
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        id: draft.id ?? undefined, provider: draft.provider, label: draft.label.trim(),
        senderAddress: draft.senderAddress.trim(), senderName: draft.senderName.trim() || 'SYKABELAJAR',
        priority: existing?.priority ?? (accounts.length + 1) * 10,
        quotaHourLimit: draft.quotaHourLimit, quotaDayLimit: draft.quotaDayLimit, quotaMonthLimit: draft.quotaMonthLimit,
      };
      if (customConfig) payload.customConfig = customConfig;
      else if (Object.keys(credentials).length) payload.credentials = credentials;
      applySettings(await request('save', payload));
      setDraft(EMPTY_DRAFT); setEditing(false);
      toast.success('Profil ' + PROVIDER_LABELS[draft.provider] + ' disimpan. Kredensial terenkripsi di D1.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Gagal menyimpan provider.'); }
    finally { setSaving(false); }
  };

  const move = (index: number, delta: number) => {
    const next = [...accounts];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setAccounts(next.map((item, order) => ({ ...item, priority: (order + 1) * 10, active: order === 0 && item.enabled })));
  };
  const saveRouting = async () => {
    setSavingRouting(true);
    try {
      applySettings(await request('configure', {
        autoFailoverEnabled,
        accounts: accounts.map((item, index) => ({
          id: item.id, enabled: item.enabled, priority: (index + 1) * 10,
          quotaHourLimit: item.quotaHourLimit, quotaDayLimit: item.quotaDayLimit, quotaMonthLimit: item.quotaMonthLimit,
        })),
      }));
      toast.success('Urutan, status, dan kuota provider disimpan.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Gagal menyimpan routing email.'); }
    finally { setSavingRouting(false); }
  };
  const test = async (account: EmailAccount) => {
    if (!window.confirm('Kirim satu email tes melalui ' + PROVIDER_LABELS[account.provider] + ' ke alamat email admin yang sedang login?')) return;
    setTestingId(account.id);
    try {
      const result = await request('test', { id: account.id });
      toast.success(String(result.message ?? 'Email tes berhasil dikirim.'));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Tes provider gagal.'); }
    finally { setTestingId(null); }
  };
  const remove = async (account: EmailAccount) => {
    if (!window.confirm('Hapus profil ' + account.label + '? Kredensial terenkripsi profil ini akan dihapus dari D1.')) return;
    setDeletingId(account.id);
    try {
      applySettings(await request('delete', { id: account.id }));
      if (draft.id === account.id) { setDraft(EMPTY_DRAFT); setEditing(false); }
      toast.success('Profil provider dihapus.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Gagal menghapus provider.'); }
    finally { setDeletingId(null); }
  };

  return (
    <Card className="p-4 md:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-muted-strong text-accent flex items-center justify-center shrink-0"><Mail size={19}/></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg">Email Transaksional</h3>
            <span className="text-[10px] rounded-full border border-accent/20 bg-accent-muted-strong text-accent px-2 py-0.5 font-semibold">Multi-provider · Server-side</span>
          </div>
          <p className="text-xs text-fg-muted mt-1">Atur lima provider bawaan atau hubungkan layanan lain melalui HTTPS JSON API kustom, lengkap dengan prioritas, failover, dan kuota.</p>
        </div>
        <Button size="sm" variant="outline" icon={<RefreshCw size={13}/>} onClick={() => void load()} disabled={loading}>Muat ulang</Button>
      </div>

      {!baseUrl && <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">Auth Worker URL belum dikonfigurasi. Atur VITE_AUTH_WORKER_URL ke Auth Worker staging.</div>}
      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2 text-xs text-red-300"><CircleAlert size={15}/><span>{error}</span></div>}

      <div className="rounded-xl border surface-border bg-surface-elevated/40 p-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-fg">Failover otomatis</p>
          <p className="text-[11px] text-fg-muted mt-0.5">Pindah ke prioritas berikutnya saat kuota habis atau provider menolak kredensial/kuota.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-fg">
          <input type="checkbox" checked={autoFailoverEnabled} onChange={(event) => setAutoFailoverEnabled(event.target.checked)}/>
          {autoFailoverEnabled ? 'Aktif' : 'Nonaktif'}
        </label>
      </div>
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] leading-relaxed text-fg-muted">
        <strong className="text-fg">Pencegahan email ganda:</strong> timeout, putus koneksi, dan HTTP 5xx tidak otomatis dicoba ulang ke provider lain karena email pertama mungkin sudah diterima. Kredensial provider tetap rahasia dan seluruh penghitung kuota berada di D1.
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-fg">Urutan provider</h4>
          <Button size="sm" icon={<Plus size={14}/>} onClick={startNew} disabled={!baseUrl || loading}>Tambah provider</Button>
        </div>
        {loading ? <div className="text-xs text-fg-muted py-5 text-center">Memuat pengaturan provider...</div> : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed surface-border p-5 text-center">
            <Mail size={20} className="mx-auto text-fg-muted mb-2"/>
            <p className="text-sm text-fg">Belum ada provider email.</p>
            <p className="text-xs text-fg-muted mt-1">Tambahkan satu akun provider dan verifikasi domain pengirim sebelum mengaktifkan verifikasi email.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account, index) => (
              <div key={account.id} className="rounded-xl border surface-border p-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center text-xs font-bold">{index + 1}</span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-fg">{account.label}</p>
                        <span className="text-[10px] rounded-full border surface-border px-2 py-0.5 font-semibold">{PROVIDER_LABELS[account.provider]}</span>
                        {index === 0 && account.enabled && <span className="text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 px-2 py-0.5">PRIORITAS 1</span>}
                        {!account.enabled && <span className="text-[10px] rounded-full bg-surface-elevated text-fg-muted px-2 py-0.5">DINONAKTIFKAN</span>}
                      </div>
                      <p className="text-[11px] text-fg-muted">{account.senderName} · {account.senderAddress}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                    <Button size="sm" variant="subtle" icon={<ArrowUp size={13}/>} onClick={() => move(index, -1)} disabled={index === 0 || savingRouting}/>
                    <Button size="sm" variant="subtle" icon={<ArrowDown size={13}/>} onClick={() => move(index, 1)} disabled={index === accounts.length - 1 || savingRouting}/>
                    <Button size="sm" variant="outline" onClick={() => edit(account)}><Pencil size={12}/> Edit</Button>
                    <Button size="sm" variant="subtle" icon={<Send size={13}/>} onClick={() => void test(account)} loading={testingId === account.id} disabled={!!testingId || !account.credentialConfigured || !account.enabled}>Tes</Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={13}/>} onClick={() => void remove(account)} loading={deletingId === account.id} disabled={!!deletingId}/>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-fg-muted">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={account.enabled} onChange={(event) => setAccounts((items) => items.map((item) => item.id === account.id ? {...item,enabled:event.target.checked} : item))}/> Aktif dalam routing</label>
                  <span>Kredensial: {account.credentialConfigured ? 'Tersimpan terenkripsi' : 'Belum ada'}</span>
                  {account.cooldownUntil && <span className="text-amber-400">Cooldown sampai {formatDate(account.cooldownUntil)}</span>}
                  {account.lastErrorCode && <span className="text-amber-400">Error terakhir: {account.lastErrorCode}</span>}
                  {account.lastSuccessAt && <span className="text-emerald-400">Berhasil: {formatDate(account.lastSuccessAt)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['Jam', account.hourUsed, account.quotaHourLimit],
                    ['Hari', account.dayUsed, account.quotaDayLimit],
                    ['Bulan', account.monthUsed, account.quotaMonthLimit],
                  ] as const).map(([label, used, limit]) => (
                    <div key={label} className="rounded-lg bg-surface-elevated/60 px-2 py-2">
                      <div className="flex justify-between text-[10px] text-fg-muted"><span>{label}</span><span>{usageText(used,limit)}</span></div>
                      {limit > 0 && <div className="h-1.5 rounded-full bg-surface-border mt-1 overflow-hidden"><div className="h-full bg-accent" style={{width: quotaPercent(used,limit)+'%'}}/></div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {accounts.length > 0 && <div className="flex justify-end"><Button size="sm" onClick={() => void saveRouting()} loading={savingRouting}>Simpan urutan & kuota</Button></div>}

      {editing && (
        <form className="rounded-xl border border-accent/20 bg-accent-muted/10 p-3 md:p-4 space-y-3" onSubmit={(event) => void save(event)}>
          <div className="flex items-center justify-between gap-2">
            <div><h4 className="text-sm font-semibold text-fg">{draft.id ? 'Edit provider' : 'Tambah provider email'}</h4><p className="text-[11px] text-fg-muted mt-0.5">Kredensial dikirim sekali, dienkripsi di Worker, dan tidak dapat dibaca kembali.</p></div>
            <button type="button" className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-white/5" onClick={() => {setEditing(false);setDraft(EMPTY_DRAFT);}} aria-label="Tutup form"><X size={15}/></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-fg-muted">Penyedia email
              <select className="input mt-1 w-full" value={draft.provider} onChange={(event) => changeProvider(event.target.value as EmailProvider)} disabled={!!draft.id}>
                {Object.entries(PROVIDER_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-fg-muted">Nama profil
              <input className="input mt-1 w-full" value={draft.label} onChange={(event) => setDraft((current) => ({...current,label:event.target.value}))} placeholder="Contoh: SendPulse Utama" maxLength={80} required/>
            </label>
            <label className="block text-xs text-fg-muted">Nama pengirim
              <input className="input mt-1 w-full" value={draft.senderName} onChange={(event) => setDraft((current) => ({...current,senderName:event.target.value}))} maxLength={120} required/>
            </label>
            <label className="block text-xs text-fg-muted">Email pengirim terverifikasi
              <input className="input mt-1 w-full" type="email" value={draft.senderAddress} onChange={(event) => setDraft((current) => ({...current,senderAddress:event.target.value}))} placeholder="noreply@sykabelajar.my.id" required/>
            </label>
            {draft.provider !== 'custom_http' ? (
              <>
                <label className="block text-xs text-fg-muted sm:col-span-2">
                  {draft.provider === 'mailjet' ? 'Public API Key' : draft.provider === 'mailtrap' ? 'Mailtrap API Token (Email Sending)' : draft.provider === 'sendpulse' ? 'SendPulse Static API Key' : draft.provider === 'brevo' ? 'Brevo API Key v3' : 'Resend API Key'}
                  <input className="input mt-1 w-full" type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setDraft((current) => ({...current,apiKey:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan kredensial saat ini' : 'Tempel kredensial provider'} required={!draft.id}/>
                </label>
                {draft.provider === 'mailjet' && <label className="block text-xs text-fg-muted sm:col-span-2">Private API Key
                  <input className="input mt-1 w-full" type="password" autoComplete="new-password" value={draft.apiSecret} onChange={(event) => setDraft((current) => ({...current,apiSecret:event.target.value}))} placeholder={draft.id ? 'Kosongkan jika tidak mengganti' : 'Tempel Private API Key'} required={!draft.id}/>
                </label>}
              </>
            ) : (
              <>
                <label className="block text-xs text-fg-muted sm:col-span-2">HTTPS API Endpoint
                  <input className="input mt-1 w-full" type="url" value={draft.endpointUrl} onChange={(event) => setDraft((current) => ({...current,endpointUrl:event.target.value}))} placeholder="https://api.provider.com/v1/email/send" required/>
                </label>
                <label className="block text-xs text-fg-muted">Metode autentikasi
                  <select className="input mt-1 w-full" value={draft.authMode} onChange={(event) => setDraft((current) => ({...current,authMode:event.target.value as CustomAuthMode}))}>
                    <option value="bearer">Bearer token</option><option value="api_key">API key pada header khusus</option><option value="basic">HTTP Basic Auth</option><option value="none">Tanpa autentikasi</option>
                  </select>
                </label>
                {(draft.authMode === 'bearer' || draft.authMode === 'api_key') && <label className="block text-xs text-fg-muted">API key / token
                  <input className="input mt-1 w-full" type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setDraft((current) => ({...current,apiKey:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan token tersimpan' : 'Masukkan API key/token'} required={!draft.id}/>
                </label>}
                {draft.authMode === 'api_key' && <>
                  <label className="block text-xs text-fg-muted">Nama header autentikasi
                    <input className="input mt-1 w-full" value={draft.authHeaderName} onChange={(event) => setDraft((current) => ({...current,authHeaderName:event.target.value}))} placeholder="X-API-Key"/>
                  </label>
                  <label className="block text-xs text-fg-muted">Prefix opsional
                    <input className="input mt-1 w-full" value={draft.authPrefix} onChange={(event) => setDraft((current) => ({...current,authPrefix:event.target.value}))} placeholder="Kosongkan atau isi Token"/>
                  </label>
                </>}
                {draft.authMode === 'basic' && <>
                  <label className="block text-xs text-fg-muted">Username
                    <input className="input mt-1 w-full" autoComplete="off" value={draft.username} onChange={(event) => setDraft((current) => ({...current,username:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan' : 'Username API'}/>
                  </label>
                  <label className="block text-xs text-fg-muted">Password
                    <input className="input mt-1 w-full" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft((current) => ({...current,password:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan' : 'Password API'}/>
                  </label>
                </>}
                <label className="block text-xs text-fg-muted sm:col-span-2">Header tambahan (JSON opsional)
                  <textarea className="input mt-1 w-full min-h-20 font-mono text-[11px]" value={draft.extraHeadersJson} onChange={(event) => setDraft((current) => ({...current,extraHeadersJson:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan header tersimpan' : '{"X-Project":"sykabelajar"}'}/>
                </label>
                <label className="block text-xs text-fg-muted sm:col-span-2">Template payload JSON
                  <textarea className="input mt-1 w-full min-h-40 font-mono text-[11px]" value={draft.payloadTemplateJson} onChange={(event) => setDraft((current) => ({...current,payloadTemplateJson:event.target.value}))} placeholder={draft.id ? 'Kosongkan untuk mempertahankan template tersimpan' : '{ "from": {"email":"{{from.email}}","name":"{{from.name}}"}, "to":[{"email":"{{to}}"}], "subject":"{{subject}}", "text":"{{text}}" }'}/>
                  <span className="mt-1 block text-[10px] text-fg-muted">Placeholder: {'{{from.email}}'}, {'{{from.name}}'}, {'{{to}}'}, {'{{subject}}'}, {'{{text}}'}, {'{{action}}'}. Payload harus JSON object.</span>
                </label>
                <div className="sm:col-span-2 rounded-lg bg-surface-elevated/70 px-3 py-2 text-[11px] text-fg-muted">Sistem mengirim POST JSON melalui HTTPS. Respons HTTP 2xx dianggap diterima. 401/403 dan 402/429 dapat memicu failover; timeout dan 5xx tidak dicoba ulang agar tidak mengirim email ganda. URL lokal/IP dan redirect ditolak.</div>
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs text-fg-muted">Batas / jam (0 = bebas)
              <input className="input mt-1 w-full" type="number" min="0" max="1000000" value={draft.quotaHourLimit} onChange={(event) => setDraft((current) => ({...current,quotaHourLimit:Number(event.target.value)}))}/>
            </label>
            <label className="block text-xs text-fg-muted">Batas / hari (0 = bebas)
              <input className="input mt-1 w-full" type="number" min="0" max="1000000" value={draft.quotaDayLimit} onChange={(event) => setDraft((current) => ({...current,quotaDayLimit:Number(event.target.value)}))}/>
            </label>
            <label className="block text-xs text-fg-muted">Batas / bulan (0 = bebas)
              <input className="input mt-1 w-full" type="number" min="0" max="1000000" value={draft.quotaMonthLimit} onChange={(event) => setDraft((current) => ({...current,quotaMonthLimit:Number(event.target.value)}))}/>
            </label>
          </div>
          <div className="rounded-lg bg-surface-elevated/70 px-3 py-2 text-[11px] text-fg-muted">{providerQuotaHint(draft.provider)} Penghitung internal berbasis UTC dan bisa kamu sesuaikan. Sistem tidak membaca sisa kuota akun provider secara langsung.</div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => {setEditing(false);setDraft(EMPTY_DRAFT);}} disabled={saving}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!baseUrl}>{draft.id ? 'Simpan perubahan' : 'Simpan provider'}</Button>
          </div>
        </form>
      )}

      <div className="border-t surface-border pt-3 flex items-start gap-2 text-[11px] text-fg-muted">
        <ShieldCheck size={14} className="shrink-0 mt-0.5 text-accent"/>
        <p>Gunakan hanya untuk email transaksional seperti verifikasi akun dan reset password. Tes hanya dikirim ke email admin yang login, maksimal sekali per menit. Domain/sender harus diverifikasi di masing-masing provider. Angka kuota awal adalah batas paket gratis yang terdokumentasi; penggunaan dari aplikasi lain pada akun provider tidak terhitung oleh D1.</p>
      </div>
    </Card>
  );
}

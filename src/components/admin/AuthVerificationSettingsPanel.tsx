import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getStagingAdminAccessToken } from '@/services/adminBetterAuthAccessToken';

type Policy = {
  emailVerificationRequired: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

const STAGING_APP_HOST = 'staging.sykabelajar.my.id';
const STAGING_AUTH_WORKER_URL = 'https://auth.sykabelajar.my.id';
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Worker menolak token Admin.',
  AUTH_RESOURCE_TOKEN_INVALID: 'Worker tidak dapat memverifikasi resource-token Better Auth.',
  AUTH_RESOURCE_TOKEN_HEADER_INVALID: 'Header token bukan format ES256/JWT yang diharapkan Worker.',
  AUTH_RESOURCE_TOKEN_FORMAT_INVALID: 'Format resource-token Better Auth tidak valid.',
  AUTH_RESOURCE_TOKEN_SIGNATURE_INVALID: 'Signature token tidak cocok dengan kunci publik JWKS Worker.',
  AUTH_RESOURCE_TOKEN_EXPIRED: 'Resource-token sudah kedaluwarsa. Muat ulang sesi staging.',
  AUTH_RESOURCE_TOKEN_CLAIMS_INVALID: 'Klaim issuer, audience, sub, role, atau masa berlaku token tidak sesuai.',
  AUTH_JWKS_ENDPOINT_NOT_FOUND: 'Endpoint JWKS Better Auth tidak ditemukan (HTTP 404).',
  AUTH_JWKS_ACCESS_DENIED: 'Endpoint JWKS Better Auth menolak permintaan (HTTP 401/403).',
  AUTH_JWKS_KEY_NOT_FOUND: 'Kunci penandatangan token tidak ditemukan pada JWKS Worker.',
  AUTH_JWKS_KEY_AMBIGUOUS: 'JWKS Worker memiliki lebih dari satu kunci yang cocok untuk token.',
  AUTH_JWKS_UNAVAILABLE: 'Worker tidak dapat membaca kunci publik Better Auth dari D1.',
  AUTH_JWKS_INVALID: 'Respons JWKS dari issuer Better Auth tidak valid.',
  AUTH_USERINFO_UNAVAILABLE: 'Endpoint UserInfo Better Auth tidak dapat dihubungi.',
  AUTH_USERINFO_INVALID: 'Identitas UserInfo tidak cocok atau email belum terverifikasi.',
  AUTH_SESSION_REQUIRED: 'Sesi Better Auth staging tidak ditemukan. Login ulang melalui staging.',
  AUTH_SESSION_EXPIRED: 'Sesi Better Auth staging sudah berakhir. Login ulang melalui staging.',
  AUTH_STAGING_APP_ORIGIN_REQUIRED: 'Buka Admin melalui staging.sykabelajar.my.id, bukan link preview Pages.',
  BETTER_AUTH_FRONTEND_DISABLED: 'Better Auth frontend staging belum aktif pada halaman ini.',
};

function friendlyAuthError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'AUTH_RUNTIME_SETTINGS_UNAVAILABLE';
  return AUTH_ERROR_MESSAGES[code] ?? code;
}

function isStagingAdminHost(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === STAGING_APP_HOST;
}

async function isVerificationPolicyApiAvailable(): Promise<boolean> {
  const token = await getStagingAdminAccessToken();

  const response = await fetch(STAGING_AUTH_WORKER_URL + '/api/admin/email-settings', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null) as
    | { ok?: boolean; error?: string; emailVerificationPolicyAvailable?: boolean }
    | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || 'EMAIL_SETTINGS_REQUEST_FAILED');
  }
  return payload.emailVerificationPolicyAvailable === true;
}

async function requestPolicy(
  action: 'get-verification-policy' | 'set-verification-policy',
  required?: boolean,
): Promise<Policy> {
  const token = await getStagingAdminAccessToken();

  const response = await fetch(STAGING_AUTH_WORKER_URL + '/api/admin/email-settings', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      action,
      ...(typeof required === 'boolean' ? { emailVerificationRequired: required } : {}),
    }),
  });
  const payload = await response.json().catch(() => null) as
    | { ok?: boolean; error?: string; emailVerificationRequired?: boolean; updatedAt?: string; updatedBy?: string }
    | null;
  if (!response.ok || payload?.ok !== true || typeof payload.emailVerificationRequired !== 'boolean') {
    throw new Error(payload?.error || 'AUTH_RUNTIME_SETTINGS_UNAVAILABLE');
  }
  return {
    emailVerificationRequired: payload.emailVerificationRequired,
    updatedAt: payload.updatedAt ?? null,
    updatedBy: payload.updatedBy ?? null,
  };
}

export function AuthVerificationSettingsPanel() {
  const visible = isStagingAdminHost();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError('');
    try {
      const supported = await isVerificationPolicyApiAvailable();
      setAvailable(supported);
      if (!supported) {
        setPolicy(null);
        return;
      }
      setPolicy(await requestPolicy('get-verification-policy'));
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => { void load(); }, [load]);

  const save = async (required: boolean) => {
    const confirmation = required
      ? 'Wajibkan verifikasi email kembali? Akun baru tidak dapat membuat session sebelum email diverifikasi.'
      : 'Nonaktifkan verifikasi email sementara? Akun baru dapat login tanpa membuktikan kepemilikan alamat email.';
    if (!window.confirm(confirmation)) return;

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await requestPolicy('set-verification-policy', required);
      setPolicy(next);
      setMessage(required
        ? 'Verifikasi email sekarang diwajibkan di staging.'
        : 'Bypass verifikasi email sementara aktif di staging.');
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!visible || (!loading && !available && !error)) return null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-accent" />
            <h3 className="font-semibold text-fg">Verifikasi Email Better Auth</h3>
            <Badge color="info">Staging</Badge>
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            Atur kewajiban verifikasi email untuk registrasi dan pembuatan session. Perubahan disimpan di D1 dan berlaku tanpa redeploy.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || saving}>
          <RefreshCw size={14} /> Muat ulang
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-fg-muted">Memuat kebijakan verifikasi…</p>
      ) : policy ? (
        <div className="rounded-xl border surface-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Status sekarang</span>
            <Badge color={policy.emailVerificationRequired ? 'moss' : 'warn'}>
              {policy.emailVerificationRequired ? 'Wajib verifikasi' : 'Bypass aktif'}
            </Badge>
          </div>
          <p className="text-xs text-fg-muted">
            {policy.emailVerificationRequired
              ? 'Email wajib diverifikasi sebelum session login diterbitkan.'
              : 'Akun dapat masuk tanpa verifikasi email. Gunakan bypass hanya untuk pengujian staging.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={saving || policy.emailVerificationRequired}
              onClick={() => void save(true)}
            >
              Aktifkan wajib verifikasi
            </Button>
            <Button
              size="sm"
              disabled={saving || !policy.emailVerificationRequired}
              onClick={() => void save(false)}
            >
              Nonaktifkan sementara
            </Button>
          </div>
          <p className="text-[11px] text-fg-muted">
            Terakhir diubah: {policy.updatedAt ? new Date(policy.updatedAt).toLocaleString('id-ID') : '—'}
            {' · '}Admin ID: {policy.updatedBy ?? '—'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          Status verifikasi belum dapat dimuat. Periksa sesi Admin dan koneksi Auth Worker staging.
        </p>
      )}

      <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
        <AlertTriangle size={16} className="shrink-0" />
        <p>
          Pengaturan ini hanya mengubah Auth Worker/D1 staging. Jangan gunakan bypass di Production; alamat email pengguna harus dibuktikan sebelum login.
        </p>
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-400">{message}</p>}
    </Card>
  );
}

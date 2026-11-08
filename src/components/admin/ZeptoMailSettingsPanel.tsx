import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Mail, Pencil, Plus, RefreshCw, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { getSupabaseResourceAccessToken } from '@/services/applicationAccessToken';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type EmailAccount = {
  id: string;
  label: string;
  provider: 'zeptomail' | 'brevo';
  senderAddress: string;
  senderName: string;
  bounceAddress: string | null;
  tokenConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};

type SettingsResponse = {
  activeAccountId: string | null;
  accounts: EmailAccount[];
};

type AccountDraft = {
  id: string | null;
  provider: 'zeptomail' | 'brevo';
  label: string;
  senderAddress: string;
  senderName: string;
  bounceAddress: string;
  sendMailToken: string;
};

const EMPTY_DRAFT: AccountDraft = {
  id: null,
  provider: 'brevo',
  label: '',
  senderAddress: '',
  senderName: 'SYKABELAJAR',
  bounceAddress: '',
  sendMailToken: '',
};

const ERROR_LABELS: Record<string, string> = {
  AUTH_REQUIRED: 'Sesi admin tidak ditemukan. Silakan login kembali.',
  ADMIN_REQUIRED: 'Hanya admin aktif yang dapat mengelola email.',
  ADMIN_AUTH_NOT_CONFIGURED: 'Verifikasi admin belum dikonfigurasi pada Auth Worker.',
  ADMIN_CHECK_FAILED: 'Server tidak dapat memverifikasi role admin.',
  ADMIN_AUTH_UNAVAILABLE: 'Layanan verifikasi admin sementara tidak tersedia. Coba lagi nanti.',
  INVALID_ACCOUNT_LABEL: 'Nama akun wajib diisi (maksimal 80 karakter).',
  INVALID_SENDER_ADDRESS: 'Alamat pengirim tidak valid.',
  INVALID_SENDER_NAME: 'Nama pengirim terlalu panjang.',
  INVALID_BOUNCE_ADDRESS: 'Alamat bounce tidak valid.',
  SEND_MAIL_TOKEN_REQUIRED: 'Kredensial email wajib diisi untuk akun baru.',
  EMAIL_PROVIDER_CREDENTIAL_REQUIRED: 'Kredensial wajib diisi saat menambah akun atau mengganti penyedia.',
  INVALID_EMAIL_PROVIDER: 'Penyedia email tidak didukung.',
  INVALID_SEND_MAIL_TOKEN: 'Format atau panjang kredensial tidak valid.',
  BREVO_AUTH_FAILED: 'Brevo menolak API Key. Periksa API Key dari akun Brevo.',
  ZEPTO_MAIL_AUTH_FAILED: 'ZeptoMail menolak token Agent. Periksa kembali token yang dipasang.',
  EMAIL_TEST_RATE_LIMITED: 'Tes email dibatasi satu kali per menit untuk setiap admin.',
  ACTIVE_EMAIL_ACCOUNT_CANNOT_BE_DELETED: 'Pilih Agent lain sebelum menghapus Agent aktif.',
};

const STAGING_PREVIEW_HOST = 'security-auth-poc-stage-1.sykabelajar4.pages.dev';
const STAGING_AUTH_WORKER_URL = 'https://auth.sykabelajar.my.id';

function authWorkerUrl() {
  const configured = String(import.meta.env.VITE_AUTH_WORKER_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  // The migration branch preview is isolated from the production site.
  // Keep the fallback pinned to this exact Pages hostname, never a wildcard.
  if (typeof window !== 'undefined' && window.location.hostname === STAGING_PREVIEW_HOST) {
    return STAGING_AUTH_WORKER_URL;
  }
  return '';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ZeptoMailSettingsPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = useMemo(() => authWorkerUrl(), []);

  const getAccessToken = useCallback(async () => {
    const accessToken = await getSupabaseResourceAccessToken();
    if (!accessToken) throw new Error('AUTH_REQUIRED');
    return accessToken;
  }, []);

  const request = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    if (!baseUrl) throw new Error('AUTH_WORKER_URL_NOT_CONFIGURED');
    const accessToken = await getAccessToken();
    const response = await fetch(baseUrl + '/api/admin/email-settings', {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify({ action, ...payload }) } : {}),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || result?.ok !== true) {
      const code = String(result?.error ?? 'EMAIL_SETTINGS_REQUEST_FAILED');
      const message = String(result?.message ?? ERROR_LABELS[code] ?? 'Pengaturan email gagal diproses.');
      throw new Error(ERROR_LABELS[code] ?? message);
    }
    return result;
  }, [baseUrl, getAccessToken]);

  const applySettings = useCallback((settings: unknown) => {
    const value = settings as SettingsResponse;
    setAccounts(Array.isArray(value?.accounts) ? value.accounts : []);
    setActiveAccountId(typeof value?.activeAccountId === 'string' ? value.activeAccountId : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request('get');
      applySettings(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Gagal memuat pengaturan email.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [request, applySettings]);

  useEffect(() => { void load(); }, [load]);

  const editAccount = (account: EmailAccount) => {
    setDraft({
      id: account.id,
      provider: account.provider,
      label: account.label,
      senderAddress: account.senderAddress,
      senderName: account.senderName,
      bounceAddress: account.bounceAddress ?? '',
      sendMailToken: '',
    });
    setEditing(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.label.trim() || !draft.senderAddress.trim()) {
      toast.warning('Nama Agent dan alamat pengirim wajib diisi.');
      return;
    }
    const existingAccount = draft.id ? accounts.find((account) => account.id === draft.id) : undefined;
    const credentialRequired = !existingAccount || existingAccount.provider !== draft.provider;
    if (credentialRequired && !draft.sendMailToken.trim()) {
      toast.warning('API Key / Send Mail Token wajib diisi untuk penyedia yang dipilih.');
      return;
    }
    setSaving(true);
    try {
      const result = await request('save', {
        id: draft.id ?? undefined,
        provider: draft.provider,
        label: draft.label.trim(),
        senderAddress: draft.senderAddress.trim(),
        senderName: draft.senderName.trim() || 'SYKABELAJAR',
        bounceAddress: draft.bounceAddress.trim(),
        sendMailToken: draft.sendMailToken.trim(),
      });
      applySettings(result);
      setDraft(EMPTY_DRAFT);
      setEditing(false);
      toast.success('Akun email berhasil disimpan. Kredensial tetap terenkripsi di server.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal menyimpan Agent ZeptoMail.');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (account: EmailAccount) => {
    if (account.active) return;
    const confirmed = window.confirm(
      'Jadikan Agent "' + account.label + '" sebagai pengirim email aktif? Email verifikasi dan reset password berikutnya akan menggunakan Agent ini.',
    );
    if (!confirmed) return;
    setActivatingId(account.id);
    try {
      const result = await request('activate', { id: account.id });
      applySettings(result);
      toast.success('Agent email aktif berhasil diganti.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal mengaktifkan Agent.');
    } finally {
      setActivatingId(null);
    }
  };

  const test = async (account: EmailAccount) => {
    const confirmed = window.confirm(
      'Kirim satu email tes ke alamat email admin yang sedang login menggunakan ' + (account.provider === 'brevo' ? 'Brevo' : 'ZeptoMail') + ' · ' + account.label + '?',
    );
    if (!confirmed) return;
    setTestingId(account.id);
    try {
      const result = await request('test', { id: account.id });
      toast.success(String(result.message ?? 'Email tes berhasil dikirim ke email admin.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Tes email ZeptoMail gagal.');
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (account: EmailAccount) => {
    if (account.active) {
      toast.warning('Pilih Agent lain terlebih dahulu sebelum menghapus Agent aktif.');
      return;
    }
    if (!window.confirm('Hapus profil Agent "' + account.label + '"? Token terenkripsi untuk profil ini akan dihapus dari D1.')) return;
    setDeletingId(account.id);
    try {
      const result = await request('delete', { id: account.id });
      applySettings(result);
      if (draft.id === account.id) {
        setDraft(EMPTY_DRAFT);
        setEditing(false);
      }
      toast.success('Profil Agent berhasil dihapus.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal menghapus Agent.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="p-4 md:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-muted-strong text-accent flex items-center justify-center shrink-0">
          <Mail size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg">Email Transaksional</h3>
            <span className="text-[10px] rounded-full border border-accent/20 bg-accent-muted-strong text-accent px-2 py-0.5 font-semibold">Server-side</span>
          </div>
          <p className="text-xs text-fg-muted mt-1">
            Kelola akun Brevo Free atau ZeptoMail, simpan kredensial terenkripsi, dan ganti pengirim aktif tanpa redeploy Worker.
          </p>
        </div>
        <Button size="sm" variant="outline" icon={<RefreshCw size={13} />} onClick={() => void load()} disabled={loading}>
          Muat ulang
        </Button>
      </div>

      {!baseUrl && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
          Auth Worker URL belum dikonfigurasi. Atur <code>VITE_AUTH_WORKER_URL</code> ke URL Worker staging setelah Worker dan D1 siap.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2 text-xs text-red-300">
          <CircleAlert size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border surface-border bg-surface-elevated/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-fg">Agent pengirim aktif</p>
            <p className="text-[11px] text-fg-muted mt-0.5">
              {accounts.find((account) => account.id === activeAccountId)?.label ?? 'Belum ada Agent aktif'}
            </p>
          </div>
          {activeAccountId ? <span className="text-[10px] text-emerald-400 font-semibold inline-flex items-center gap-1"><CheckCircle2 size={13}/> Aktif</span> : <span className="text-[10px] text-amber-300 font-semibold">Belum dikonfigurasi</span>}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-fg">Daftar Agent</h4>
          <Button size="sm" icon={<Plus size={14}/>} onClick={() => { setDraft(EMPTY_DRAFT); setEditing(true); }} disabled={!baseUrl || loading}>
            Tambah Agent
          </Button>
        </div>
        {loading ? (
          <div className="text-xs text-fg-muted py-5 text-center">Memuat pengaturan email...</div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed surface-border p-5 text-center">
            <Mail size={20} className="mx-auto text-fg-muted mb-2"/>
            <p className="text-sm text-fg">Belum ada akun email transaksional.</p>
            <p className="text-xs text-fg-muted mt-1">Tambahkan akun Brevo atau ZeptoMail. Akun baru menggunakan Brevo Free sebagai pilihan awal.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div key={account.id} className="rounded-xl border surface-border p-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-fg truncate">{account.label}</p>
                      <span className="text-[10px] rounded-full border surface-border px-2 py-0.5 font-semibold">{account.provider === 'brevo' ? 'BREVO' : 'ZEPTOMAIL'}</span>
                      {account.active && <span className="text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 px-2 py-0.5 font-semibold">AKTIF</span>}
                    </div>
                    <p className="text-xs text-fg-muted mt-1">{account.senderName} · {account.senderAddress}</p>
                    <p className="text-[10px] text-fg-muted mt-1">
                      Token: {account.tokenConfigured ? 'Tersimpan terenkripsi' : 'Belum ada'} · Diperbarui {formatDate(account.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    {!account.active && <Button size="sm" variant="outline" onClick={() => void activate(account)} loading={activatingId === account.id} disabled={!!activatingId}>Aktifkan</Button>}
                    <Button size="sm" variant="subtle" icon={<Send size={13}/>} onClick={() => void test(account)} loading={testingId === account.id} disabled={!!testingId || !account.tokenConfigured}>Tes</Button>
                    <Button size="sm" variant="subtle" icon={<Pencil size={13}/>} onClick={() => editAccount(account)} disabled={!!saving}>Edit</Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={13}/>} onClick={() => void remove(account)} loading={deletingId === account.id} disabled={account.active || !!deletingId}>Hapus</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <form className="rounded-xl border border-accent/20 bg-accent-muted/10 p-3 md:p-4 space-y-3" onSubmit={(event) => void save(event)}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">{draft.id ? 'Edit akun email' : 'Tambah akun email'}</h4>
              <p className="text-[11px] text-fg-muted mt-0.5">Setiap akun menyimpan penyedia, alamat pengirim, dan kredensial terenkripsi.</p>
            </div>
            <button type="button" className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-white/5" onClick={() => { setEditing(false); setDraft(EMPTY_DRAFT); }} aria-label="Tutup form">
              <X size={15}/>
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-fg-muted">
              Penyedia email
              <select className="input mt-1 w-full" value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as AccountDraft['provider'], sendMailToken: '' }))}>
                <option value="brevo">Brevo Free · 300 email/hari</option>
                <option value="zeptomail">ZeptoMail · kredit / pay-as-you-go</option>
              </select>
            </label>
            <label className="block text-xs text-fg-muted">
              Nama profil / akun
              <input className="input mt-1 w-full" value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Contoh: Agent Utama" maxLength={80} required />
            </label>
            <label className="block text-xs text-fg-muted">
              Nama pengirim
              <input className="input mt-1 w-full" value={draft.senderName} onChange={(event) => setDraft((current) => ({ ...current, senderName: event.target.value }))} placeholder="SYKABELAJAR" maxLength={120} required />
            </label>
            <label className="block text-xs text-fg-muted">
              Email pengirim terverifikasi
              <input className="input mt-1 w-full" type="email" value={draft.senderAddress} onChange={(event) => setDraft((current) => ({ ...current, senderAddress: event.target.value }))} placeholder="noreply@sykabelajar.my.id" required />
            </label>
            <label className="block text-xs text-fg-muted">
              Bounce address (opsional)
              <input className="input mt-1 w-full" type="email" value={draft.bounceAddress} onChange={(event) => setDraft((current) => ({ ...current, bounceAddress: event.target.value }))} placeholder="bounce@sykabelajar.my.id" />
            </label>
          </div>

          <label className="block text-xs text-fg-muted">
            {draft.provider === 'brevo' ? 'Brevo API Key (v3)' : 'ZeptoMail Send Mail Token'}
            <input className="input mt-1 w-full" type="password" autoComplete="new-password" value={draft.sendMailToken} onChange={(event) => setDraft((current) => ({ ...current, sendMailToken: event.target.value }))} placeholder={draft.provider === 'brevo' ? (draft.id ? 'Kosongkan jika tidak mengganti API Key' : 'Tempel API Key Brevo v3') : (draft.id ? 'Kosongkan jika tidak mengganti token' : 'Tempel Send Mail Token dari Agent')} required={!draft.id || accounts.find((account) => account.id === draft.id)?.provider !== draft.provider} />
            <span className="block text-[10px] mt-1.5">Kredensial hanya dikirim saat disimpan, dienkripsi di Worker, dan tidak pernah ditampilkan kembali. Mengganti jenis penyedia mewajibkan kredensial baru.</span>
          </label>

          {draft.provider === 'brevo' ? (
            <div className="rounded-lg bg-surface-elevated/70 px-3 py-2 text-[11px] text-fg-muted">
              Brevo Free menyediakan transactional email hingga <strong>300 email per hari</strong>. Ambil API Key v3 dari akun Brevo dan verifikasi domain pengirim sebelum mengaktifkannya. Batas gratis harian tidak di-bypass otomatis; email yang melewati kuota dapat tertahan.
            </div>
          ) : (
            <div className="rounded-lg bg-surface-elevated/70 px-3 py-2 text-[11px] text-fg-muted">
              Ambil token di ZeptoMail: <strong>Agents → pilih Agent → SMTP/API → API → Send Mail Token</strong>. ZeptoMail pay-as-you-go; kredit gratis pertama hanya promosi terbatas waktu. Jangan aktifkan auto top-up atau membeli kredit pada proyek Free-only.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(false); setDraft(EMPTY_DRAFT); }} disabled={saving}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!baseUrl}>{draft.id ? 'Simpan perubahan' : 'Simpan Agent'}</Button>
          </div>
        </form>
      )}

      <div className="border-t surface-border pt-3 flex items-start gap-2 text-[11px] text-fg-muted">
        <ShieldCheck size={14} className="shrink-0 mt-0.5 text-accent"/>
        <p>Kredensial tidak dapat dibaca lewat API admin. Tes hanya dikirim ke email admin yang sedang login dan dibatasi satu kali per menit. Mengganti akun aktif berlaku untuk email verifikasi dan reset password berikutnya.</p>
      </div>
    </Card>
  );
}

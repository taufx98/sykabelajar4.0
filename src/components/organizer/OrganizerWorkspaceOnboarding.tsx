import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Copy, KeyRound, MailCheck, Phone, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { setSelectedOrganizerId } from '@/services/organizerAuth.service';

type SetupMode = 'create' | 'join';
type SetupResult = {
  id: string;
  name: string;
  slug: string;
  mode: SetupMode;
  accessCode?: string;
};

function normalizePhone(value: string): string | null {
  const raw = value.trim().replace(/[\s().-]/g, '');
  if (!raw) return null;
  let normalized: string;
  if (raw.startsWith('+')) {
    normalized = `+${raw.slice(1).replace(/\D/g, '')}`;
  } else {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('0')) normalized = `+62${digits.slice(1)}`;
    else if (digits.startsWith('62')) normalized = `+${digits}`;
    else normalized = `+62${digits}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function readableOrganizerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const value = raw.toUpperCase();
  if (value.includes('EMAIL_VERIFICATION_REQUIRED')) return 'Verifikasi email akun terlebih dahulu, lalu masuk kembali.';
  if (value.includes('PHONE_VERIFICATION_REQUIRED')) return 'Nomor telepon harus diverifikasi melalui kode OTP sebelum membuat organisasi.';
  if (value.includes('FREE_ORGANIZER_ALREADY_CLAIMED')) return 'Nomor telepon ini sudah digunakan untuk klaim workspace gratis. Hubungi admin bila ini keliru.';
  if (value.includes('ORGANIZER_LIMIT_REACHED')) return 'Akun ini sudah memiliki workspace penyelenggara.';
  if (value.includes('ORGANIZER_ROLE_REQUIRED')) return 'Akun belum memiliki role Penyelenggara yang aktif.';
  if (value.includes('ORGANIZER_NOT_FOUND')) return 'Organisasi tidak ditemukan atau tidak aktif.';
  if (value.includes('INVALID_ACCESS_CODE')) return 'Kode undangan salah atau sudah tidak berlaku.';
  if (value.includes('duplicate key') || value.includes('organizers_slug_key')) return 'Slug organisasi sudah digunakan. Pilih slug lain.';
  if (value.includes('SMS') && (value.includes('PROVIDER') || value.includes('CONFIG'))) {
    return 'Pengiriman OTP telepon belum tersedia di konfigurasi autentikasi. Hubungi admin untuk mengaktifkan provider SMS.';
  }
  return raw || 'Operasi organisasi gagal. Coba kembali.';
}

export function OrganizerWorkspaceOnboarding({ onContinue }: { onContinue: () => Promise<void> }) {
  const { toast } = useApp();
  const [mode, setMode] = useState<SetupMode>('create');
  const [authLoading, setAuthLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [confirmedPhone, setConfirmedPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [joinSlug, setJoinSlug] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error('Masuk terlebih dahulu untuk mengelola organisasi.');
        if (!live) return;
        setEmailConfirmed(Boolean(data.user.email_confirmed_at));
        const verified = data.user.phone_confirmed_at ? normalizePhone(data.user.phone ?? '') : null;
        setConfirmedPhone(verified ?? '');
        setPhone(verified ?? '');
      } catch (error) {
        if (live) toast(readableOrganizerError(error), 'error');
      } finally {
        if (live) setAuthLoading(false);
      }
    })();
    return () => { live = false; };
  }, [toast]);

  const normalizedPhone = normalizePhone(phone);
  const phoneVerified = Boolean(normalizedPhone && confirmedPhone && normalizedPhone === confirmedPhone);

  const handleSendOtp = async () => {
    if (!emailConfirmed) {
      toast('Verifikasi email terlebih dahulu sebelum membuat workspace.', 'error');
      return;
    }
    if (!normalizedPhone) {
      toast('Masukkan nomor telepon valid dengan kode negara, misalnya +6281234567890.', 'error');
      return;
    }
    if (phoneVerified) {
      toast('Nomor telepon ini sudah terverifikasi.', 'info');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizedPhone });
      if (error) throw error;
      setPendingPhone(normalizedPhone);
      setOtp('');
      setOtpSent(true);
      toast('Kode OTP dikirim ke nomor telepon. Masukkan kode untuk melanjutkan.', 'success');
    } catch (error) {
      toast(readableOrganizerError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!pendingPhone || !/^\d{6}$/.test(otp.trim())) {
      toast('Masukkan kode OTP 6 digit yang dikirim ke telepon.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: pendingPhone,
        token: otp.trim(),
        type: 'phone_change',
      });
      if (error) throw error;
      let verifiedUser = data.user;
      if (!verifiedUser?.phone_confirmed_at) {
        const refreshed = await supabase.auth.getUser();
        if (refreshed.error) throw refreshed.error;
        verifiedUser = refreshed.data.user;
      }
      if (!verifiedUser?.phone_confirmed_at) {
        throw new Error('Nomor telepon belum terverifikasi di backend. Coba lagi.');
      }
      const confirmed = normalizePhone(verifiedUser.phone ?? pendingPhone) ?? pendingPhone;
      setConfirmedPhone(confirmed);
      setPhone(confirmed);
      setPendingPhone('');
      setOtp('');
      setOtpSent(false);
      toast('Nomor telepon berhasil diverifikasi.', 'success');
    } catch (error) {
      toast(readableOrganizerError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!emailConfirmed) {
      toast('Verifikasi email terlebih dahulu sebelum membuat workspace.', 'error');
      return;
    }
    if (!phoneVerified) {
      toast('Verifikasi nomor telepon terlebih dahulu sebelum membuat workspace gratis.', 'error');
      return;
    }
    const name = workspaceName.trim();
    const slug = normalizeSlug(workspaceSlug);
    if (!name || !slug) {
      toast('Nama organisasi dan slug wajib diisi.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_organizer', { p_name: name, p_slug: slug });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row?.id) throw new Error('Backend tidak mengembalikan workspace yang dibuat.');
      const created: SetupResult = {
        id: String(row.id),
        name: String(row.name ?? name),
        slug: String(row.slug ?? slug),
        mode: 'create',
        accessCode: row.access_code ? String(row.access_code) : undefined,
      };
      setSelectedOrganizerId(created.id);
      setResult(created);
      toast('Workspace berhasil dibuat.', 'success');
    } catch (error) {
      toast(readableOrganizerError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    const slug = joinSlug.trim();
    const code = accessCode.trim();
    if (!slug || !code) {
      toast('Slug/nama organisasi dan kode undangan wajib diisi.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('join_organizer', { p_slug: slug, p_access_code: code });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row?.organizer_id) throw new Error('Backend tidak mengembalikan keanggotaan organisasi.');
      const joined: SetupResult = {
        id: String(row.organizer_id),
        name: String(row.name ?? slug),
        slug: String(row.slug ?? slug),
        mode: 'join',
      };
      setSelectedOrganizerId(joined.id);
      setResult(joined);
      toast('Berhasil bergabung ke organisasi.', 'success');
    } catch (error) {
      toast(readableOrganizerError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    setBusy(true);
    try {
      await onContinue();
    } catch (error) {
      toast(readableOrganizerError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyAccessCode = async () => {
    if (!result?.accessCode) return;
    try {
      await navigator.clipboard.writeText(result.accessCode);
      toast('Kode undangan disalin.', 'success');
    } catch {
      toast('Salin kode undangan secara manual dari teks di atas.', 'info');
    }
  };

  if (authLoading) {
    return <div className="p-6 md:p-10"><Card className="max-w-xl mx-auto p-8 text-center"><p className="text-sm text-fg-muted">Memeriksa status verifikasi akun…</p></Card></div>;
  }

  if (result) {
    return <div className="p-4 md:p-8">
      <Card className="max-w-2xl mx-auto p-6 md:p-8">
        <div className="w-12 h-12 rounded-2xl bg-moss-500/10 flex items-center justify-center text-accent"><CheckCircle2 size={24} /></div>
        <h1 className="text-2xl font-bold text-fg mt-4">{result.mode === 'create' ? 'Workspace berhasil dibuat' : 'Berhasil bergabung'}</h1>
        <p className="text-sm text-fg-muted mt-2">{result.name} · {result.slug}</p>
        {result.accessCode && <div className="mt-5 rounded-xl border surface-border p-4">
          <p className="text-xs text-fg-muted">Kode undangan organisasi · simpan untuk dibagikan kepada anggota</p>
          <div className="flex items-center gap-3 mt-2">
            <code className="flex-1 break-all text-sm text-fg">{result.accessCode}</code>
            <Button variant="outline" size="sm" onClick={() => void copyAccessCode()} icon={<Copy size={15} />}>Salin</Button>
          </div>
        </div>}
        <Button className="mt-6" loading={busy} onClick={() => void handleContinue()} icon={<ShieldCheck size={17} />}>Buka Workspace</Button>
      </Card>
    </div>;
  }

  return <div className="p-4 md:p-8">
    <Card className="max-w-2xl mx-auto p-5 md:p-8">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 shrink-0 rounded-2xl bg-moss-500/10 flex items-center justify-center text-accent"><Building2 size={22} /></div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Penyelenggara</p>
          <h1 className="text-xl md:text-2xl font-bold text-fg">Selesaikan setup organisasi</h1>
          <p className="text-sm text-fg-muted mt-2">Peran akun sudah dikenali dari backend. Buat workspace sendiri atau bergabung menggunakan kode undangan.</p>
        </div>
      </div>

      <div className="flex gap-2 mt-6">
        <Button variant={mode === 'create' ? 'primary' : 'outline'} onClick={() => setMode('create')} icon={<Building2 size={16} />}>Buat Organisasi</Button>
        <Button variant={mode === 'join' ? 'primary' : 'outline'} onClick={() => setMode('join')} icon={<Users size={16} />}>Gabung Organisasi</Button>
      </div>

      {mode === 'create' ? <div className="mt-6 space-y-5">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-xs text-fg-muted">Nama organisasi
            <input className="input mt-1" autoComplete="organization" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} placeholder="Contoh: SMA Nusantara" />
          </label>
          <label className="text-xs text-fg-muted">Slug organisasi
            <input className="input mt-1" autoComplete="off" value={workspaceSlug} onChange={event => setWorkspaceSlug(normalizeSlug(event.target.value))} placeholder="sma-nusantara" />
            <span className="block mt-1">Huruf kecil, angka, dan tanda hubung.</span>
          </label>
        </div>

        <div className="rounded-xl border surface-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MailCheck size={17} className={emailConfirmed ? 'text-emerald-400' : 'text-amber-400'} />
            <span className="text-sm text-fg">{emailConfirmed ? 'Email akun terverifikasi' : 'Email perlu diverifikasi'}</span>
          </div>
          {!emailConfirmed && <p className="text-xs text-fg-muted">Verifikasi email dari tautan Supabase, lalu masuk kembali untuk membuat workspace.</p>}
          <div className="flex items-center gap-2">
            <Phone size={17} className={phoneVerified ? 'text-emerald-400' : 'text-fg-muted'} />
            <span className="text-sm text-fg">{phoneVerified ? 'Nomor telepon terverifikasi' : 'Verifikasi nomor telepon diperlukan'}</span>
          </div>
          {!phoneVerified && <>
            <label className="block text-xs text-fg-muted">Nomor telepon
              <input className="input mt-1" type="tel" autoComplete="tel" value={phone} onChange={event => { setPhone(event.target.value); setOtpSent(false); setPendingPhone(''); setOtp(''); }} placeholder="+6281234567890" />
            </label>
            {otpSent ? <div className="flex flex-col sm:flex-row gap-2">
              <input className="input flex-1" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Kode OTP 6 digit" />
              <Button loading={busy} disabled={busy || otp.trim().length !== 6} onClick={() => void handleVerifyOtp()}>Verifikasi OTP</Button>
            </div> : <Button variant="outline" loading={busy} disabled={busy || !normalizedPhone || !emailConfirmed} onClick={() => void handleSendOtp()} icon={<KeyRound size={16} />}>Kirim Kode OTP</Button>}
            <p className="text-xs text-fg-muted">Pembuatan workspace gratis membutuhkan email dan nomor telepon terverifikasi. Pemeriksaan backend tetap berlaku untuk mencegah klaim berulang.</p>
          </>}
        </div>

        <Button fullWidth loading={busy} disabled={busy || !workspaceName.trim() || !normalizeSlug(workspaceSlug) || !emailConfirmed || !phoneVerified} onClick={() => void handleCreate()} icon={<Building2 size={17} />}>Buat Workspace</Button>
      </div> : <div className="mt-6 space-y-4">
        <label className="block text-xs text-fg-muted">Slug atau nama organisasi
          <input className="input mt-1" value={joinSlug} onChange={event => setJoinSlug(event.target.value)} placeholder="nama-organisasi" />
        </label>
        <label className="block text-xs text-fg-muted">Kode undangan
          <input className="input mt-1" autoComplete="off" value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="Masukkan kode dari pemilik organisasi" />
        </label>
        <p className="text-xs text-fg-muted">Kode undangan diverifikasi oleh backend. Bergabung tidak memberikan hak pemilik organisasi.</p>
        <Button fullWidth loading={busy} disabled={busy || !joinSlug.trim() || !accessCode.trim()} onClick={() => void handleJoin()} icon={<Users size={17} />}>Gabung Organisasi</Button>
      </div>}
    </Card>
  </div>;
}

import { useState } from 'react';
import { Building2, KeyRound, Users } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { getUserRoles } from '@/services/role.service';
import { setSelectedOrganizerId } from '@/services/organizerAuth.service';
import { useApp } from '@/store/AppContext';

function inviteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toUpperCase();
  if (normalized.includes('INVALID_ACCESS_CODE')) return 'Kode undangan salah atau sudah tidak berlaku. Minta pemilik organisasi membuat kode baru.';
  if (normalized.includes('ORGANIZER_NOT_FOUND')) return 'Organisasi tidak ditemukan atau sedang tidak aktif.';
  if (normalized.includes('UNAUTHORIZED')) return 'Sesi login tidak ditemukan. Masuk kembali untuk menerima undangan.';
  return message || 'Gagal bergabung ke organisasi. Coba kembali.';
}

export function OrganizerInviteJoinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, user, refreshUser, toast } = useApp();
  const [slug, setSlug] = useState(searchParams.get('slug') ?? '');
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isAuthenticated || !user?.id) {
    return <Navigate to="/login?redirect=%2Forganizer%2Fjoin" replace />;
  }

  const normalizedCode = accessCode.replace(/[^a-f0-9]/gi, '').toLowerCase();

  const join = async () => {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug || normalizedCode.length !== 10) {
      toast('Masukkan slug organisasi dan kode undangan 10 karakter.', 'error');
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('join_organizer', {
        p_slug: normalizedSlug,
        p_access_code: normalizedCode,
      });
      if (error) throw error;

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      const organizerId = row?.organizer_id ? String(row.organizer_id) : '';
      if (!organizerId) throw new Error('Backend tidak mengembalikan organisasi yang diikuti.');

      const roles = await getUserRoles(user.id);
      if (!roles.includes('organizer_member') && !roles.includes('admin')) {
        throw new Error('Role Penyelenggara belum aktif setelah bergabung. Hubungi admin jika masalah berlanjut.');
      }

      setSelectedOrganizerId(organizerId);
      await refreshUser();
      toast(`Berhasil bergabung dengan ${String(row?.name ?? 'organisasi')}.`, 'success');
      navigate('/organizer', { replace: true });
    } catch (error) {
      toast(inviteErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen surface-bg flex items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-xl p-5 md:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Building2 size={22} />
          </div>
          <div className="min-w-0">
            <Badge color="moss">Undangan penyelenggara</Badge>
            <h1 className="mt-2 text-xl font-bold text-fg md:text-2xl">Gabung organisasi</h1>
            <p className="mt-1 text-sm leading-6 text-fg-muted">
              Masukkan nama atau slug organisasi dan kode undangan dari pemiliknya. Akunmu akan mendapat akses sesuai peran anggota, bukan sebagai pemilik.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-xs font-medium text-fg-muted">
            Nama atau slug organisasi
            <input
              className="input mt-1"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="contoh: sma-nusantara"
              autoComplete="organization"
            />
          </label>
          <label className="block text-xs font-medium text-fg-muted">
            Kode undangan
            <input
              className="input mt-1 font-mono tracking-widest uppercase"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value.replace(/[^a-f0-9]/gi, '').slice(0, 10))}
              placeholder="10 karakter"
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={10}
            />
            <span className="mt-1 block text-[11px]">Kode hanya dapat dibuat atau dirotasi oleh pemilik/admin organisasi.</span>
          </label>
          <Button
            fullWidth
            loading={busy}
            disabled={busy || !slug.trim() || normalizedCode.length !== 10}
            onClick={() => void join()}
            icon={<Users size={16} />}
          >
            Gabung organisasi
          </Button>
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-xl border surface-border p-3 text-xs leading-5 text-fg-muted">
          <KeyRound size={15} className="mt-0.5 shrink-0 text-accent" />
          Kode diverifikasi di server dan disimpan dalam bentuk hash. Jangan bagikan kode undangan di tempat publik.
        </div>
      </Card>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { CalendarClock, Copy, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';

type ReferralRow = {
  referred_user_id: string;
  full_name: string;
  username: string | null;
  joined_at: string;
  last_login_at: string | null;
  status: 'PENDING' | 'VERIFIED' | 'CREDITED' | 'REVOKED' | string;
  verified_at: string | null;
  verified_activity: string | null;
};

function formatActivity(value: string | null) {
  const labels: Record<string, string> = {
    daily_checkin: 'Check-in harian',
    comment: 'Komentar',
    follow: 'Mengikuti pengguna',
    chat: 'Mengirim pesan',
    daily_task: 'Menyelesaikan tugas harian',
  };
  return value ? labels[value] ?? value : '';
}

export function ReferralPage() {
  const { user, toast } = useApp();
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    let active = true;
    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_my_referrals');
        if (error) throw error;
        if (active) setRows((data ?? []) as ReferralRow[]);
      } catch (error) {
        if (active) toast(error instanceof Error ? error.message : 'Gagal memuat referral.', 'error');
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };

    void load(true);
    const channel = supabase
      .channel(`referral-events-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'referral_events',
          filter: `referrer_user_id=eq.${user.id}`,
        },
        () => { void load(false); },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  const copyReferralId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      toast('ID referral berhasil disalin.', 'success');
    } catch {
      toast('Tidak dapat menyalin ID. Silakan salin secara manual.', 'error');
    }
  };

  return (
    <div className="min-h-screen surface-bg p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center">
              <Users size={19} className="text-accent" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-fg">Referral</h1>
              <p className="text-xs text-fg-muted">Ajak teman menggunakan ID akunmu.</p>
            </div>
            <div className="ml-auto">
              <Badge color="moss">{rows.length}</Badge>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface-elevated/30 p-3">
            <p className="text-xs font-semibold text-fg">ID Referral Kamu</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-accent">{user?.id ?? 'Masuk untuk melihat ID referral'}</code>
              <button
                type="button"
                onClick={() => void copyReferralId()}
                disabled={!user?.id}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-fg transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy size={13} /> Salin ID
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              Bagikan ID ini. Temanmu cukup memasukkannya pada kolom ID Referral saat mendaftar kompetisi. Kode referral lama tetap bisa digunakan.
            </p>
          </div>

          <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-300">
            Teman akan tercatat sebagai referral setelah email terverifikasi dan melakukan salah satu aktivitas yang memenuhi syarat dalam 24 jam setelah pendaftaran referral.
          </p>
        </Card>

        <div className="space-y-2">
          {loading && <Card className="p-8 text-center text-sm text-fg-muted">Memuat referral…</Card>}
          {!loading && !rows.length && (
            <Card className="p-8 text-center text-sm text-fg-muted">
              Belum ada teman yang mendaftar menggunakan ID referral kamu.
            </Card>
          )}
          {rows.map((row) => {
            const verified = row.status === 'VERIFIED' || row.status === 'CREDITED';
            return (
              <Card key={row.referred_user_id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent font-semibold">
                    {String(row.full_name || row.username || 'P').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-fg truncate">{row.full_name}</p>
                      <Badge color={verified ? 'moss' : 'warn'}>
                        {verified ? 'Aktif' : row.status === 'REVOKED' ? 'Dibatalkan' : 'Menunggu aktivitas'}
                      </Badge>
                    </div>
                    <p className="text-xs text-accent truncate">@{row.username || 'unknown'}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-fg-muted">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock size={11} />
                        Daftar {new Date(row.joined_at).toLocaleString('id-ID')}
                      </span>
                      {verified && row.verified_at && (
                        <span>Aktif {new Date(row.verified_at).toLocaleString('id-ID')}</span>
                      )}
                    </div>
                    {verified && row.verified_activity && (
                      <p className="mt-1 text-[10px] text-fg-muted">Aktivitas: {formatActivity(row.verified_activity)}</p>
                    )}
                    {!verified && row.status === 'PENDING' && (
                      <p className="mt-1 text-[10px] text-fg-muted">
                        Menunggu email terverifikasi dan aktivitas pertama yang memenuhi kriteria.
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

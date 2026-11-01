import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Copy, Gift, Link2, Share2, Users, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';

type ReferralRow = {
  referred_user_id: string;
  full_name: string;
  username: string | null;
  joined_at: string;
  last_login_at: string | null;
  status: 'PENDING' | 'VERIFIED' | 'CREDITED' | 'REVOKED' | 'EXPIRED' | string;
  verified_at: string | null;
  verified_activity: string | null;
};

function formatActivity(value: string | null) {
  const labels: Record<string, string> = {
    daily_checkin: 'Check-in harian',
    comment: 'Membuat komentar',
    follow: 'Mengikuti pengguna',
    chat: 'Mengirim pesan chat',
    daily_task: 'Menyelesaikan tugas harian',
  };
  return value ? labels[value] ?? value : '';
}

function statusLabel(row: ReferralRow) {
  if (row.status === 'CREDITED') return 'Reward diberikan';
  if (row.status === 'VERIFIED') return 'Berhasil';
  if (row.status === 'REVOKED') return 'Dibatalkan';
  if (row.status === 'EXPIRED') return 'Kedaluwarsa';
  return row.verified_activity ? 'Menunggu verifikasi email' : 'Menunggu aktivitas';
}

export function ReferralPage() {
  const { user, toast } = useApp();
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const referralLink = useMemo(
    () => user?.id ? `${window.location.origin}/register?ref=${encodeURIComponent(user.id)}` : '',
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    let refreshTimer: number | undefined;
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
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void load(false);
      }, 250);
    };
    void load(true);
    const channel = supabase.channel(`referral-events-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'referral_events',
        filter: `referrer_user_id=eq.${user.id}`,
      }, scheduleRefresh)
      .subscribe();
    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  const successful = rows.filter((row) => row.status === 'VERIFIED' || row.status === 'CREDITED').length;
  const pending = rows.filter((row) => row.status === 'PENDING').length;

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast('Link referral berhasil disalin.', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Link belum dapat disalin. Silakan salin dari kolom tautan.', 'error');
    }
  };

  const shareLink = async () => {
    if (!referralLink) return;
    const shareData = {
      title: 'Gabung SYKABELAJAR',
      text: 'Yuk bergabung di SYKABELAJAR melalui link undanganku. Daftar lewat tautan ini agar referral terisi otomatis saat mendaftar lomba.',
      url: referralLink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    await copyLink();
  };

  return (
    <div className="min-h-screen surface-bg px-4 py-5 md:px-6 md:py-7">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">SYKABELAJAR COMMUNITY</p>
          <h1 className="font-display text-2xl font-bold text-fg md:text-3xl">Ajak teman, dapatkan reward</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">Bagikan satu tautan. Temanmu bisa membuat akun dari tautan tersebut dan ID referral akan terisi otomatis saat mendaftar lomba.</p>
        </header>

        <Card className="overflow-hidden border-accent/20 p-0">
          <div className="bg-gradient-to-br from-accent/15 via-surface-elevated/70 to-transparent p-5 md:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent"><Gift size={21}/></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">Reward referral</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-fg">5 <span className="text-base font-semibold text-accent">Edu Coin</span></p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">Untuk setiap teman yang berhasil memenuhi persyaratan referral. Reward diberikan otomatis oleh sistem.</p>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-border bg-surface-bg/80 p-3.5">
              <label htmlFor="referral-share-link" className="flex items-center gap-2 text-xs font-semibold text-fg"><Link2 size={14} className="text-accent"/> Link undangan pribadi</label>
              <input id="referral-share-link" readOnly value={referralLink} className="mt-2 w-full min-w-0 rounded-xl border border-border bg-surface-elevated/60 px-3 py-3 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent" onFocus={(event) => event.currentTarget.select()} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button fullWidth onClick={() => void copyLink()} icon={copied ? <Check size={15}/> : <Copy size={15}/>}>{copied ? 'Tersalin' : 'Salin link'}</Button>
                <Button fullWidth variant="outline" onClick={() => void shareLink()} icon={<Share2 size={15}/>}>Bagikan</Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">Link membuka formulir pembuatan akun dan menyimpan atribusi referral di perangkat temanmu. Mereka tidak perlu menyalin atau mengetik UID.</p>
            </div>
          </div>
        </Card>

        <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Ringkasan referral">
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-1.5 text-fg-muted"><Users size={14}/><span className="text-[10px] sm:text-xs">Total</span></div><p className="mt-2 text-xl font-bold tabular-nums text-fg">{rows.length}</p></Card>
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-1.5 text-fg-muted"><Check size={14}/><span className="text-[10px] sm:text-xs">Berhasil</span></div><p className="mt-2 text-xl font-bold tabular-nums text-fg">{successful}</p></Card>
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-1.5 text-fg-muted"><Wallet size={14}/><span className="text-[10px] sm:text-xs">Reward</span></div><p className="mt-2 text-xl font-bold tabular-nums text-fg">{successful * 5} <span className="text-[10px] font-medium text-fg-muted">Coin</span></p></Card>
        </section>

        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-elevated text-accent"><Users size={17}/></span><div><h2 className="text-sm font-bold text-fg">Cara kerja referral</h2><p className="text-xs text-fg-muted">Cukup tiga langkah sederhana</p></div></div>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            <li className="flex gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">1</span><p className="text-xs leading-relaxed text-fg-muted">Bagikan link undangan pribadimu kepada teman.</p></li>
            <li className="flex gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">2</span><p className="text-xs leading-relaxed text-fg-muted">Teman membuat akun melalui link, lalu mendaftar salah satu lomba.</p></li>
            <li className="flex gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">3</span><p className="text-xs leading-relaxed text-fg-muted">Teman memverifikasi email dan melakukan aktivitas yang memenuhi syarat dalam 24 jam setelah referral tercatat.</p></li>
          </ol>
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-fg-muted">
            <p className="font-semibold text-fg">Kapan reward diberikan?</p>
            <p className="mt-1">Setelah email teman terverifikasi dan aktivitas pertamanya tercatat. Aktivitas yang diterima: check-in harian, komentar, mengikuti pengguna, mengirim pesan, atau menyelesaikan tugas harian. Satu akun hanya dapat dihitung satu kali.</p>
          </div>
          {pending > 0 && <p className="mt-3 text-xs text-fg-muted">{pending} referral masih menunggu persyaratan.</p>}
        </Card>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-fg">Aktivitas referral</h2><p className="text-xs text-fg-muted">Pantau teman yang bergabung melalui undanganmu.</p></div><Badge color="moss">{rows.length} teman</Badge></div>
          {loading && <Card className="p-8 text-center text-sm text-fg-muted">Memuat aktivitas referral…</Card>}
          {!loading && rows.length === 0 && <Card className="p-7 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated text-fg-muted"><Users size={20}/></div><p className="mt-3 text-sm font-semibold text-fg">Belum ada referral</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">Bagikan link undanganmu. Teman yang mendaftar lomba melalui link tersebut akan muncul di sini.</p></Card>}
          {!loading && rows.map((row) => {
            const verified = row.status === 'VERIFIED' || row.status === 'CREDITED';
            return <Card key={row.referred_user_id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 font-semibold text-accent">{String(row.full_name || row.username || 'P').slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-fg">{row.full_name}</p><Badge color={verified ? 'moss' : row.status === 'EXPIRED' || row.status === 'REVOKED' ? 'err' : 'warn'}>{statusLabel(row)}</Badge></div>
                  <p className="truncate text-xs text-accent">@{row.username || 'pengguna'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-fg-muted"><span className="inline-flex items-center gap-1"><CalendarClock size={11}/> Bergabung {new Date(row.joined_at).toLocaleDateString('id-ID')}</span>{row.verified_at && <span>Valid {new Date(row.verified_at).toLocaleDateString('id-ID')}</span>}</div>
                  {row.verified_activity && <p className="mt-1 text-[10px] text-fg-muted">Aktivitas: {formatActivity(row.verified_activity)}</p>}
                </div>
              </div>
            </Card>;
          })}
        </section>
      </div>
    </div>
  );
}

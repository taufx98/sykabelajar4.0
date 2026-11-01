import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Award, Bell, CheckCheck, Clock, Coins, ExternalLink, Gift, Play, TrendingUp, Truck, UserCheck, UserPlus, UserX, X, Trophy, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { timeAgo } from '@/lib/utils';
import { listNotifications } from '@/services/notification.service';
import { respondFollowRequest } from '@/services/chat.service';
import { emitSykaEvent, subscribeSykaEvents } from '@/lib/realtimeBus';
import { showToast } from '@/lib/toast';
import type { AppNotification } from '@/types';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/lib/supabase';
import { ReferralProgramPanel } from '@/components/referrals/ReferralProgramPanel';

type NotificationAction = { label: string; url: string };
type NotificationData = {
  link?: string;
  action?: NotificationAction;
  follower_id?: string;
  resolved?: boolean;
  description?: string;
  amount?: number | string;
  sender_name?: string;
  from_admin?: boolean;
  organization_name?: string;
  urgent?: boolean;
  badge_name?: string;
  badge_description?: string;
  badge_icon_url?: string;
  badge_icon_emoji?: string;
  badge_rarity?: string;
  award_source_label?: string;
  payment_currency?: string;
  edu_coin_spent?: number | string;
  edu_coin_balance?: number | string;
};
type DetailNotification = AppNotification & { data?: NotificationData | null };
type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];
type NotificationFilter = 'all' | 'unread' | 'coin' | 'badge' | 'registration';
type NotificationCategory = 'coin' | 'badge' | 'registration' | 'general';
type ReferralPreview = { reward_amount: number; is_active: boolean; is_event_active: boolean };

const filters: { key: NotificationFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'unread', label: 'Belum Dibaca' },
  { key: 'coin', label: 'Edu Coin' },
  { key: 'badge', label: 'Badge' },
  { key: 'registration', label: 'Pendaftaran' },
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const toNotificationData = (value: unknown): NotificationData | null => {
  if (!isRecord(value)) return null;
  const action = isRecord(value.action) && typeof value.action.label === 'string' && typeof value.action.url === 'string'
    ? { label: value.action.label, url: value.action.url }
    : undefined;
  return {
    link: typeof value.link === 'string' ? value.link : undefined,
    action,
    follower_id: typeof value.follower_id === 'string' ? value.follower_id : undefined,
    resolved: typeof value.resolved === 'boolean' ? value.resolved : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    amount: typeof value.amount === 'number' || typeof value.amount === 'string' ? value.amount : undefined,
    sender_name: typeof value.sender_name === 'string' ? value.sender_name : undefined,
    from_admin: typeof value.from_admin === 'boolean' ? value.from_admin : undefined,
    organization_name: typeof value.organization_name === 'string' ? value.organization_name : undefined,
    urgent: typeof value.urgent === 'boolean' ? value.urgent : undefined,
    badge_name: typeof value.badge_name === 'string' ? value.badge_name : undefined,
    badge_description: typeof value.badge_description === 'string' ? value.badge_description : undefined,
    badge_icon_url: typeof value.badge_icon_url === 'string' ? value.badge_icon_url : undefined,
    badge_icon_emoji: typeof value.badge_icon_emoji === 'string' ? value.badge_icon_emoji : undefined,
    badge_rarity: typeof value.badge_rarity === 'string' ? value.badge_rarity : undefined,
    award_source_label: typeof value.award_source_label === 'string' ? value.award_source_label : undefined,
    payment_currency: typeof value.payment_currency === 'string' ? value.payment_currency : undefined,
    edu_coin_spent: typeof value.edu_coin_spent === 'number' || typeof value.edu_coin_spent === 'string' ? value.edu_coin_spent : undefined,
    edu_coin_balance: typeof value.edu_coin_balance === 'number' || typeof value.edu_coin_balance === 'string' ? value.edu_coin_balance : undefined,
  };
};

const mapNotification = (n: NotificationRow): DetailNotification => {
  const data = toNotificationData(n.data);
  return {
    id: String(n.id),
    type: String(n.type) as AppNotification['type'],
    title: String(n.title ?? ''),
    body: String(n.body ?? ''),
    createdAt: String(n.created_at),
    read: Boolean(n.read_at),
    link: data?.link,
    data,
  };
};

const categoryFor = (n: DetailNotification): NotificationCategory => {
  const content = `${n.type} ${n.title} ${n.body}`.toLowerCase();
  if (n.data?.payment_currency === 'EDU_COIN' || n.data?.edu_coin_spent != null || /edu.?coin|\bcoin\b|wallet|saldo|reward|bonus/.test(content)) return 'coin';
  if (/badge|achievement|pencapaian|sertifikat|certificate|award/.test(content)) return 'badge';
  if (/registration|pendaftaran|lomba|kompetisi|competition/.test(content)) return 'registration';
  return 'general';
};

const categoryLabel = (category: NotificationCategory) => ({
  coin: 'Edu Coin',
  badge: 'Pencapaian Badge',
  registration: 'Pendaftaran Lomba',
  general: 'Informasi',
})[category];

const categoryStyle = (category: NotificationCategory) => ({
  coin: 'border-amber-500/25 bg-amber-500/10 text-amber-500',
  badge: 'border-purple-500/25 bg-purple-500/10 text-purple-400',
  registration: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
  general: 'border-[#3B82F6]/25 bg-[#3B82F6]/10 text-[#3B82F6]',
})[category];

const iconFor = (n: DetailNotification) => {
  const category = categoryFor(n);
  if (category === 'coin') return <Coins size={18} className="text-amber-400"/>;
  if (category === 'badge') return <Award size={18} className="text-purple-400"/>;
  if (category === 'registration') return <Trophy size={18} className="text-emerald-400"/>;
  switch (n.type) {
    case 'result-out': return <Trophy size={18} className="text-amber-400"/>;
    case 'competition-start': return <Play size={18} className="text-sky-400"/>;
    case 'rank-up': return <TrendingUp size={18} className="text-[#3B82F6]"/>;
    case 'registration-rejected': return <AlertCircle size={18} className="text-red-400"/>;
    case 'registration-approved': return <Award size={18} className="text-emerald-400"/>;
    case 'follow-request': return <UserPlus size={18} className="text-sky-400"/>;
    case 'follow-accepted': return <UserCheck size={18} className="text-emerald-400"/>;
    case 'order-update': return <Truck size={18} className="text-sky-400"/>;
    case 'daily-reminder': return <Clock size={18} className="text-amber-400"/>;
    default: return <Bell size={18} className="text-[#60A5FA]"/>;
  }
};

const actionFor = (n: DetailNotification): NotificationAction | null => {
  const data = n.data ?? {};
  if (data.action) return data.action;
  switch (n.type) {
    case 'follow-request': return null;
    case 'rank-up': return { label: 'Cek Profil', url: data.link ?? '/leaderboard' };
    case 'result-out': return { label: 'Lihat Hasil', url: data.link ?? '/awards' };
    case 'registration-approved': return { label: 'Lihat Lomba', url: data.link ?? '/awards' };
    case 'twibbon-verified': return { label: 'Lihat', url: data.link ?? '/awards' };
    default: return data.link ? { label: 'Buka', url: data.link } : null;
  }
};

function getFilterCount(rows: DetailNotification[], filter: NotificationFilter) {
  if (filter === 'all') return rows.length;
  if (filter === 'unread') return rows.filter((row) => !row.read).length;
  return rows.filter((row) => categoryFor(row) === filter).length;
}

export function NotificationsPage() {
  const { user, toast, markNotificationRead, markAllNotificationsRead } = useApp();
  const { language } = useLanguage();
  const text = (id: string, en: string) => language === 'en' ? en : id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'referral' ? 'referral' : 'notifications';
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [rows, setRows] = useState<DetailNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DetailNotification | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [referralPreview, setReferralPreview] = useState<ReferralPreview | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setReferralPreview(null);
      return;
    }
    let live = true;
    const loadReferralPreview = async () => {
      const { data, error } = await supabase.rpc('get_referral_program_settings');
      if (!live || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object') return;
      const settings = row as Record<string, unknown>;
      setReferralPreview({
        reward_amount: Math.max(0, Number(settings.reward_amount) || 0),
        is_active: Boolean(settings.is_active),
        is_event_active: Boolean(settings.is_event_active),
      });
    };
    const channel = supabase.channel('referral-program-settings-notifications', { config: { private: false } })
      .on('broadcast', { event: 'updated' }, () => { void loadReferralPreview(); })
      .subscribe();
    const onFocus = () => { void loadReferralPreview(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void loadReferralPreview(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    void loadReferralPreview();
    return () => {
      live = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    let live = true;
    if (!user) {
      setRows([]);
      setLoading(false);
      return () => { live = false; };
    }
    setLoading(true);
    listNotifications(user.id)
      .then((result) => { if (live) setRows(result.map(mapNotification)); })
      .catch((error) => { if (live) toast(error instanceof Error ? error.message : 'Notifikasi gagal dimuat.', 'error'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [user?.id, toast]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeSykaEvents((event) => {
      if (event.type === 'notification-inserted' && event.notification) {
        const notification = mapNotification(event.notification as unknown as NotificationRow);
        setRows((previous) => previous.some((row) => row.id === notification.id) ? previous : [notification, ...previous]);
      }
      if (event.type === 'notification-read') {
        setRows((previous) => previous.map((row) => row.id === event.notificationId ? { ...row, read: true } : row));
      }
      if (event.type === 'notification-all-read') {
        setRows((previous) => previous.map((row) => row.data?.urgent ? row : { ...row, read: true }));
      }
    });
    return unsubscribe;
  }, [user?.id]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const unread = useMemo(() => rows.filter((row) => !row.read), [rows]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !row.read;
    return categoryFor(row) === filter;
  }), [rows, filter]);

  const switchTab = (tab: 'notifications' | 'referral') => {
    setFilter('all');
    setSelected(null);
    setSearchParams(tab === 'notifications' ? {} : { tab: 'referral' }, { replace: true });
  };

  const open = async (notification: DetailNotification) => {
    setSelected(notification);
    if (notification.read) return;
    setRows((previous) => previous.map((row) => row.id === notification.id ? { ...row, read: true } : row));
    emitSykaEvent({ type: 'notification-read', notificationId: notification.id });
    try {
      await markNotificationRead(notification.id);
    } catch {
      setRows((previous) => previous.map((row) => row.id === notification.id ? { ...row, read: false } : row));
      emitSykaEvent({ type: 'notification-inserted', notificationId: notification.id });
      showToast(text('Notifikasi belum berhasil ditandai dibaca.', 'Notification could not be marked as read.'), 'warning');
    }
  };

  const allRead = async () => {
    const targets = rows.filter((row) => !row.read && !Boolean(row.data?.urgent));
    if (!targets.length) return;
    setRows((previous) => previous.map((row) => targets.some((target) => target.id === row.id) ? { ...row, read: true } : row));
    emitSykaEvent({ type: 'notification-all-read' });
    try {
      await markAllNotificationsRead();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Gagal menandai notifikasi.', 'error');
    }
  };

  const decide = async (notification: DetailNotification, accept: boolean) => {
    if (!user || busy) return;
    const followerId = notification.data?.follower_id;
    if (!followerId) {
      showToast(text('Permintaan mengikuti tidak valid.', 'Invalid follow request.'), 'error');
      return;
    }
    setBusy(notification.id);
    try {
      await respondFollowRequest(followerId, accept);
      setRows((previous) => previous.map((row) => row.id === notification.id ? { ...row, read: true, data: { ...row.data, resolved: true } } : row));
      emitSykaEvent({ type: 'notification-read', notificationId: notification.id });
      await markNotificationRead(notification.id);
      showToast(accept ? text('Permintaan mengikuti diterima.', 'Follow request accepted.') : text('Permintaan mengikuti ditolak.', 'Follow request rejected.'), 'success');
      setSelected(null);
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : text('Gagal memproses permintaan.', 'Could not process request.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const goAction = (notification: DetailNotification) => {
    const action = actionFor(notification);
    if (!action) return;
    setRows((previous) => previous.map((row) => row.id === notification.id ? { ...row, read: true } : row));
    emitSykaEvent({ type: 'notification-read', notificationId: notification.id });
    void markNotificationRead(notification.id).catch(() => undefined);
    setSelected(null);
    navigate(action.url);
  };

  const renderNotification = (notification: DetailNotification) => {
    const sender = notification.data?.sender_name || notification.data?.organization_name || 'Sistem SYKABELAJAR';
    const category = categoryFor(notification);
    return (
      <button key={notification.id} type="button" onClick={() => void open(notification)} className="group h-full w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1120]">
        <Card className={`relative flex h-full items-start justify-between gap-3 overflow-hidden border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${!notification.read ? 'border-[#3B82F6]/50 bg-white shadow-sm shadow-blue-950/5 dark:bg-[#151E32]' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-[#1E293B] dark:bg-[#151E32] dark:hover:border-slate-700'}`}>
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${categoryStyle(category)}`}>{iconFor(notification)}</div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-white">{notification.title}</h3>
                {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#3B82F6] shadow-[0_0_0_3px_rgba(59,130,246,0.12)]" aria-label="Belum dibaca"/>}
                {notification.data?.urgent && <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-400">Penting</span>}
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{notification.body}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500"><span>{timeAgo(notification.createdAt)}</span><span aria-hidden="true">·</span><span className="truncate">{sender}</span></div>
            </div>
          </div>
          <ArrowRight size={14} className="mt-2 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#3B82F6]"/>
        </Card>
      </button>
    );
  };

  const selectedCategory = selected ? categoryFor(selected) : 'general';
  const selectedAction = selected ? actionFor(selected) : null;
  const selectedAmountValue = selected?.data?.edu_coin_spent ?? selected?.data?.amount;
  const selectedAmount = selectedAmountValue != null ? Number(selectedAmountValue) : null;
  const selectedIsSpending = selected?.data?.edu_coin_spent != null;
  const registrationContent = `${selected?.title ?? ''} ${selected?.body ?? ''}`.toLowerCase();
  const registrationStatus = /ditolak|rejected/.test(registrationContent)
    ? 'Ditolak'
    : /disetujui|approved|langsung aktif/.test(registrationContent)
      ? 'Disetujui'
      : 'Menunggu proses';

  return (
    <div className="min-h-full bg-[#F8FAFC] px-4 pb-10 pt-5 text-slate-800 dark:bg-[#0B1120] dark:text-slate-200 sm:px-6 sm:pt-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-5 dark:border-[#1E293B]/80 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-400 dark:text-slate-500"><span>Aktivitas</span><span aria-hidden="true">›</span><span className="text-slate-600 dark:text-slate-300">Notifikasi &amp; Referral</span></div>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">Notifikasi &amp; Program Referral</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Kabar akun, aktivitas, dan undangan komunitasmu dalam satu tempat.</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-[#3B82F6]/20 bg-[#3B82F6]/10 px-3 py-1.5 text-[11px] font-bold text-[#3B82F6]"><Bell size={13}/>{unread.length} belum dibaca</div>
        </header>

        <div className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-[#1E293B] dark:bg-[#151E32] sm:flex-row sm:items-center">
          <div className="flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-[#1E293B] dark:bg-[#0B1120]/70 sm:w-auto">
            <button type="button" onClick={() => switchTab('notifications')} aria-pressed={activeTab === 'notifications'} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all sm:flex-initial ${activeTab === 'notifications' ? 'bg-[#2563EB] text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-[#1C273E] dark:hover:text-slate-200'}`}><Bell size={14}/><span>Notifikasi Pesan</span><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === 'notifications' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>{unread.length}</span></button>
            <button type="button" onClick={() => switchTab('referral')} aria-pressed={activeTab === 'referral'} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all sm:flex-initial ${activeTab === 'referral' ? 'bg-[#2563EB] text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-[#1C273E] dark:hover:text-slate-200'}`}><Gift size={14} className={activeTab === 'referral' ? 'text-white' : 'text-[#60A5FA]'}/><span>Program Referral</span>{referralPreview?.is_active && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${activeTab === 'referral' ? 'bg-white/20 text-white' : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-500'}`}>+{referralPreview.reward_amount.toLocaleString('id-ID')} Coin</span>}</button>
          </div>
          {activeTab === 'notifications' && (
            <div className="flex justify-end">
              {unread.some((row) => !Boolean(row.data?.urgent)) && <Button size="sm" variant="ghost" onClick={() => void allRead()} icon={<CheckCheck size={14}/>}>Tandai Semua Dibaca</Button>}
            </div>
          )}
        </div>

        {activeTab === 'referral' ? <ReferralProgramPanel/> : (
          <section className="space-y-4">
            <div className="relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border border-[#3B82F6]/30 bg-gradient-to-r from-[#1E3A8A]/40 via-indigo-900/20 to-purple-900/30 p-4 shadow-lg shadow-blue-950/5 sm:flex-row sm:items-center sm:p-5">
              <div className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-[#3B82F6]/10 blur-3xl"/>
              <div className="relative z-10 flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#2563EB] to-indigo-500 text-white shadow-lg shadow-blue-500/20"><Users size={22}/></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">Ajak Teman, Dapatkan Edu Coin!</h2><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-500">{referralPreview?.is_event_active ? 'Bonus Event Aktif' : 'Program Referral'}</span>{referralPreview?.is_active && <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-500">+{referralPreview.reward_amount.toLocaleString('id-ID')} Edu Coin</span>}</div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600 dark:text-slate-300">Bagikan link undanganmu dan pantau reward yang sedang berlaku dari satu halaman.</p>
                </div>
              </div>
              <button type="button" onClick={() => switchTab('referral')} className="relative z-10 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/25 transition hover:bg-[#1D4ED8] sm:w-auto">Buka Program Referral<ArrowRight size={14}/></button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1" role="group" aria-label="Filter notifikasi">
              <span className="mr-1 shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">Filter:</span>
              {filters.map(({ key, label }) => {
                const active = filter === key;
                const count = getFilterCount(rows, key);
                return <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={active} className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${active ? 'border-[#2563EB] bg-[#2563EB] text-white shadow-md shadow-blue-600/20' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-[#1E293B] dark:bg-[#151E32] dark:text-slate-300 dark:hover:bg-[#1C273E]'}`}>{label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>{count}</span></button>;
              })}
            </div>

            {loading ? <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2" aria-label="Memuat notifikasi"><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-[#151E32]"/><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-[#151E32]"/><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-[#151E32]"/></div>
              : filteredRows.length === 0 ? <Card className="px-6 py-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800"><Bell size={22}/></div><h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{rows.length === 0 ? 'Belum Ada Notifikasi' : 'Tidak Ada Notifikasi di Filter Ini'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">{rows.length === 0 ? 'Notifikasi baru akan muncul di sini saat ada aktivitas pada akunmu.' : 'Coba pilih filter yang lain untuk melihat notifikasi.'}</p></Card>
              : <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">{filteredRows.map(renderNotification)}</div>}
          </section>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="notification-modal-title" className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#151E32]">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800/80 dark:bg-slate-900/40">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${categoryStyle(selectedCategory)}`}>{iconFor(selected)}</div>
                <div className="min-w-0"><h4 className="truncate text-xs font-bold text-slate-900 dark:text-white">{selected.data?.sender_name || selected.data?.organization_name || 'Sistem SYKABELAJAR'}</h4><p className="mt-0.5 text-[11px] font-medium text-slate-400">{new Date(selected.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p></div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 transition hover:bg-slate-300 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white" aria-label="Tutup"><X size={15}/></button>
            </div>
            <div className="max-h-[calc(90vh-145px)] space-y-5 overflow-y-auto p-5 sm:p-6">
              <div><span className={`mb-2 inline-flex rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${categoryStyle(selectedCategory)}`}>{categoryLabel(selectedCategory)}</span><h3 id="notification-modal-title" className="text-lg font-extrabold leading-snug text-slate-900 dark:text-white">{selected.title}</h3></div>
              {selectedCategory === 'coin' && selectedAmount != null && Number.isFinite(selectedAmount) && (
                <div className="flex flex-col items-center justify-center space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-800 dark:bg-slate-900/70"><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-lg shadow-amber-500/10"><Coins size={28}/></div><div><span className="block text-xs font-semibold text-slate-400">{selectedIsSpending ? 'Edu Coin Digunakan' : 'Nominal Reward'}</span><span className="text-2xl font-black tracking-tight text-amber-500">{selectedIsSpending ? '−' : selectedAmount > 0 ? '+' : ''}{Math.abs(selectedAmount).toLocaleString('id-ID')} EDU</span>{selected?.data?.edu_coin_balance != null && <span className="mt-1 block text-[10px] text-slate-500">Saldo setelah transaksi: {Number(selected.data.edu_coin_balance).toLocaleString('id-ID')} Edu Coin</span>}</div><span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold text-emerald-500"><CheckCheck size={12}/> Informasi dari sistem</span></div>
              )}
              {selectedCategory === 'badge' && (
                <div className="flex flex-col items-center justify-center space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-tr from-purple-600/20 to-indigo-500/20 text-purple-400 shadow-lg shadow-purple-500/10">
                    {selected.data?.badge_icon_url ? <img src={selected.data.badge_icon_url} alt={selected.data.badge_name || 'Ikon badge'} className="h-full w-full object-contain"/> : selected.data?.badge_icon_emoji ? <span className="text-3xl">{selected.data.badge_icon_emoji}</span> : <Award size={30}/>}
                  </div>
                  <div><h5 className="text-sm font-extrabold text-slate-900 dark:text-white">{selected.data?.badge_name || selected.title}</h5><p className="mt-0.5 text-xs font-medium text-purple-500">{selected.data?.badge_rarity || 'Badge pencapaian'}</p></div>
                  {selected.data?.badge_description && <p className="max-w-sm text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{selected.data.badge_description}</p>}
                  {selected.data?.award_source_label && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Sumber: {selected.data.award_source_label}</span>}
                </div>
              )}
              {selectedCategory === 'registration' && (
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-500"><Trophy size={22}/></div>
                  <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status Pendaftaran</p><p className={`mt-1 text-xs font-extrabold ${registrationStatus === 'Disetujui' ? 'text-emerald-500' : registrationStatus === 'Ditolak' ? 'text-red-400' : 'text-amber-500'}`}>{registrationStatus}</p><p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Informasi mengikuti status yang dikirim sistem penyelenggara.</p></div>
                </div>
              )}
              <div><p className="text-sm font-bold leading-relaxed text-slate-800 dark:text-slate-200">{selected.body}</p>{selected.data?.description && <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{selected.data.description}</p>}</div>
              {selected.data?.sender_name && !selected.data?.from_admin && <p className="text-xs text-slate-500">Pengirim: <span className="font-semibold text-slate-800 dark:text-slate-200">{selected.data.sender_name}</span></p>}
              {selected.data?.organization_name && <p className="text-xs text-slate-500">Organisasi: <span className="font-semibold text-slate-800 dark:text-slate-200">{selected.data.organization_name}</span></p>}
              {selected.type === 'follow-request' && !selected.data?.resolved ? <div className="flex gap-2"><Button fullWidth disabled={busy === selected.id} onClick={() => void decide(selected, true)} icon={<UserCheck size={14}/>}>Terima</Button><Button fullWidth variant="outline" disabled={busy === selected.id} onClick={() => void decide(selected, false)} icon={<UserX size={14}/>}>Tolak</Button></div>
                : <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>{selectedAction && <Button onClick={() => goAction(selected)} icon={<ExternalLink size={14}/>}>{selectedAction.label}</Button>}</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-[10px] font-medium text-slate-400 dark:border-slate-800/80 dark:bg-slate-900/30"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/><span>Terverifikasi oleh sistem SYKABELAJAR</span></div>
          </section>
        </div>
      )}
    </div>
  );
}

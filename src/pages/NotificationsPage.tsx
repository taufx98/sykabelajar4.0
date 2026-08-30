import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, Trophy, Play, TrendingUp, Truck, Clock, AlertCircle, MoreHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { timeAgo } from '@/lib/utils';
import { listNotifications } from '@/services/notification.service';
import type { AppNotification, NotificationType } from '@/types';

const ICONS: Record<NotificationType, React.ReactNode> = {
  'competition-start': <Play size={16} className="text-sky-400" />,
  'result-out': <Trophy size={16} className="text-amber-400" />,
  'registration-approved': <Check size={16} className="text-moss-400" />,
  'registration-rejected': <AlertCircle size={16} className="text-red-400" />,
  'order-update': <Truck size={16} className="text-sky-400" />,
  'daily-reminder': <Clock size={16} className="text-amber-400" />,
  'rank-up': <TrendingUp size={16} className="text-moss-400" />,
  'twibbon-verified': <Check size={16} className="text-moss-400" />,
};

function mapNotification(n: any): AppNotification {
  return {
    id: String(n.id),
    type: n.type as AppNotification['type'],
    title: String(n.title ?? ''),
    body: String(n.body ?? ''),
    createdAt: String(n.created_at),
    read: Boolean(n.read_at),
    link: n.data?.link,
  };
}

export function NotificationsPage() {
  const { user, toast, markNotificationRead, markAllNotificationsRead } = useApp();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const unread = notifications.filter((n) => !n.read);

  useEffect(() => {
    let alive = true;
    if (!user) { setNotifications([]); setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    listNotifications(user.id)
      .then((rows) => { if (alive) setNotifications(rows.map(mapNotification)); })
      .catch((error) => { if (alive) toast(error?.message ?? 'Notifikasi gagal dimuat', 'error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, toast]);

  const handleRead = async (id: string) => {
    if (!user) return;
    await markNotificationRead(id);
    setNotifications((items) => items.map((n) => n.id === id ? { ...n, read: true } : n));
  };

  const handleAllRead = async () => {
    if (!user) return;
    await markAllNotificationsRead();
    setNotifications((items) => items.map((n) => ({ ...n, read: true })));
    toast('Semua notifikasi ditandai dibaca', 'info');
  };

  return (
    <div>
      <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3 flex items-center justify-between">
        <div><h2 className="font-display font-bold text-lg text-fg">Notifikasi</h2><p className="text-xs text-slate-500">{unread.length} belum dibaca</p></div>
        {unread.length > 0 && <Button size="sm" variant="ghost" onClick={() => void handleAllRead()} icon={<CheckCheck size={14} />}>Tandai Semua</Button>}
      </div>
      <div className="p-4 space-y-2">
        {loading ? <div className="text-center py-16 text-sm text-slate-500">Memuat notifikasi…</div> : notifications.length === 0 ? (
          <div className="text-center py-16"><Bell size={40} className="text-slate-700 mx-auto mb-3"/><p className="text-sm text-slate-500">Belum ada notifikasi</p></div>
        ) : notifications.map((n) => (
          <Link key={n.id} to={n.link || '#'} onClick={() => void handleRead(n.id)}>
            <Card className={`p-4 flex items-start gap-3 transition cursor-pointer ${!n.read ? 'border-moss-500/20 bg-moss-500/5' : 'opacity-70'}`}>
              <div className="w-9 h-9 rounded-xl surface-elevated flex items-center justify-center shrink-0">{ICONS[n.type] ?? <Bell size={16} className="text-slate-400"/>}</div>
              <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-0.5"><p className="text-sm font-semibold text-fg">{n.title}</p>{!n.read && <span className="w-2 h-2 rounded-full bg-moss-400 shrink-0"/>}</div><p className="text-xs text-slate-400 line-clamp-2">{n.body}</p><p className="text-[10px] text-slate-600 mt-1">{timeAgo(n.createdAt)}</p></div>
              <button className="p-1 text-slate-600 hover:text-slate-400" onClick={(e) => { e.preventDefault(); void handleRead(n.id); }}>{n.read ? <MoreHorizontal size={14}/> : <div className="w-2 h-2 rounded-full bg-moss-400"/>}</button>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

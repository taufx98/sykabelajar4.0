import { useEffect, useState } from 'react';
import { Home, CalendarCheck, BarChart3, Award, Bell, ShoppingBag, User as UserIcon, LogOut, Menu, GraduationCap, LogIn, UserPlus, ShieldCheck, Building2, Megaphone, MessageCircle, SlidersHorizontal } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RankBadge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { getUnreadChatCount } from '@/services/chat.service';
import { getPersistentCache, setPersistentCache } from '@/lib/persistentCache';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { startPublicRealtime, startUserRealtime } from '@/lib/realtimeHub';
import { subscribeSykaEvents } from '@/lib/realtimeBus';

type NavItem = [string, string, typeof Home, number | undefined];
const CHAT_CACHE_TTL = 30 * 60_000;
const ORDER_CACHE_TTL = 30 * 60_000;

export function AppLayout() {
  const { user, isGuest, logout, unreadNotificationCount } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadOrders, setUnreadOrders] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [liveUnreadNotifications, setLiveUnreadNotifications] = useState(unreadNotificationCount);
  const isAdmin = user?.role === 'admin';
  const isOrganizer = user?.role === 'penyelenggara';
  const chatPath = isAdmin ? '/admin/chat' : '/pesan';

  useEffect(() => {
    setLiveUnreadNotifications(unreadNotificationCount);
  }, [unreadNotificationCount]);

  useEffect(() => {
    const stopPublic = startPublicRealtime();
    if (isGuest || !user) {
      setUnreadMessages(0);
      setUnreadOrders(0);
      return () => stopPublic();
    }

    const stopUser = startUserRealtime(user.id, isAdmin);

    const chatCacheKey = `chat.unread.${user.id}`;
    const orderCacheKey = `admin.orders.unread.${user.id}`;
    const cachedChat = getPersistentCache<number>(chatCacheKey);
    if (cachedChat) {
      setUnreadMessages(Math.max(0, Number(cachedChat.data) || 0));
    } else {
      void getUnreadChatCount().then((count) => {
        setUnreadMessages(count);
        setPersistentCache(chatCacheKey, count, { ttlMs: CHAT_CACHE_TTL });
      }).catch(() => setUnreadMessages(0));
    }

    if (isAdmin) {
      const cachedOrders = getPersistentCache<number>(orderCacheKey);
      if (cachedOrders) {
        setUnreadOrders(Math.max(0, Number(cachedOrders.data) || 0));
      } else {
        const lastVisit = localStorage.getItem('admin_orders_last_visit');
        let query = supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_proof_status', 'SUBMITTED');
        if (lastVisit) query = query.gt('created_at', lastVisit);
        void Promise.resolve(query).then(({ count }) => {
          const value = count ?? 0;
          setUnreadOrders(value);
          setPersistentCache(orderCacheKey, value, { ttlMs: ORDER_CACHE_TTL });
        }).catch(() => setUnreadOrders(0));
      }
    } else {
      setUnreadOrders(0);
    }

    const unsubscribe = subscribeSykaEvents((event) => {
      if (event.type === 'notification-inserted') {
        setLiveUnreadNotifications((value) => value + 1);
        return;
      }
      if (event.type === 'notification-read') {
        setLiveUnreadNotifications((value) => Math.max(0, value - 1));
        return;
      }
      if (event.type === 'notification-all-read') {
        setLiveUnreadNotifications(0);
        return;
      }
      if (event.type === 'chat-message') {
        const senderId = String(event.message.sender_id ?? '');
        if (senderId === user.id) return;
        setUnreadMessages((value) => {
          const next = value + 1;
          setPersistentCache(chatCacheKey, next, { ttlMs: CHAT_CACHE_TTL });
          return next;
        });
        return;
      }
      if (event.type === 'chat-read' || event.type === 'chat-hidden') {
        void getUnreadChatCount(true).then((count) => { setUnreadMessages(count); setPersistentCache(chatCacheKey, count, { ttlMs: CHAT_CACHE_TTL }); }).catch(() => {});
        return;
      }
      if (String(event.type) === 'chat-thread-updated') {
        void getUnreadChatCount(true).then((count) => {
          setUnreadMessages(count);
          setPersistentCache(chatCacheKey, count, { ttlMs: CHAT_CACHE_TTL });
        }).catch(() => {});
        return;
      }
      if (event.type === 'order-changed' && isAdmin) {
        const order = event.order;
        if (String(order.payment_proof_status ?? '') !== 'SUBMITTED') return;
        const createdAt = String(order.created_at ?? '');
        const lastVisit = localStorage.getItem('admin_orders_last_visit');
        if (lastVisit && createdAt && createdAt <= lastVisit) return;
        setUnreadOrders((value) => {
          const next = value + 1;
          setPersistentCache(orderCacheKey, next, { ttlMs: ORDER_CACHE_TTL });
          return next;
        });
      }
    });

    return () => {
      unsubscribe();
      stopUser();
      stopPublic();
    };
  }, [isGuest, user?.id, isAdmin]);

  useEffect(() => {
    if (isAdmin && location.pathname === '/admin/orders/review') {
      localStorage.setItem('admin_orders_last_visit', new Date().toISOString());
      setUnreadOrders(0);
      if (user?.id) setPersistentCache(`admin.orders.unread.${user.id}`, 0, { ttlMs: ORDER_CACHE_TTL });
    }
  }, [location.pathname, isAdmin, user?.id]);

  const profilePath = user?.username ? `/profile/@${user.username}` : '/home';
  const guestNav: NavItem[] = [['/home', 'Beranda', Home, undefined], ['/leaderboard', 'Peringkat', BarChart3, undefined], ['/awards', 'Piagam', Award, undefined]];
  const userNav: NavItem[] = [['/home', 'Beranda', Home, undefined], ['/daily-tasks', 'Daily Tasks', CalendarCheck, undefined], ['/leaderboard', 'Peringkat', BarChart3, undefined], ['/awards', 'Piagam', Award, undefined], ['/notifications', 'Notifikasi', Bell, liveUnreadNotifications > 0 ? liveUnreadNotifications : undefined], ['/orders', 'Pesanan', ShoppingBag, unreadOrders > 0 ? unreadOrders : undefined]];
  if (isOrganizer) userNav.push(['/organizer', 'Penyelenggara', Building2, undefined], ['/organizer/ads', 'Pasang Iklan', Megaphone, undefined]);
  userNav.push([chatPath, 'Pesan', MessageCircle, unreadMessages > 0 ? unreadMessages : undefined]);
  if (isAdmin) userNav.push(['/admin', 'Admin', ShieldCheck, undefined], ['/admin/plan-usage', 'Plan & Usage', SlidersHorizontal, undefined], ['/admin/organizers', 'Organisasi', Building2, undefined]);
  userNav.push([profilePath, 'Profil', UserIcon, undefined]);
  const nav: NavItem[] = isGuest ? guestNav : userNav;
  const active = (to: string) => location.pathname === to || (to === '/home' && location.pathname === '/');
  const logoutNow = () => { void logout(); navigate('/'); };
  const mobileNav: NavItem[] = [[profilePath, 'Profil', UserIcon, undefined], ['/home', 'Beranda', Home, undefined], [isAdmin ? '/admin' : isOrganizer ? '/organizer' : '/leaderboard', isAdmin ? 'Admin' : isOrganizer ? 'Penyelenggara' : 'Peringkat', isAdmin ? ShieldCheck : isOrganizer ? Building2 : BarChart3, undefined], [chatPath, 'Pesan', MessageCircle, unreadMessages > 0 ? unreadMessages : undefined]];

  return <><div className="min-h-screen max-w-[1440px] mx-auto flex surface-bg"><aside className="hidden md:flex w-[250px] xl:w-[270px] shrink-0 sticky top-0 h-screen border-r surface-border p-3 flex-col"><Link to="/home" className="flex items-center gap-2.5 px-3 py-3 mb-4"><div className="w-9 h-9 rounded-xl gradient-moss flex items-center justify-center shadow-lg shadow-moss-500/20"><GraduationCap size={19} className="text-fg"/></div><span className="font-display font-bold text-lg text-fg">sykabelajar</span></Link><nav className="space-y-0.5 flex-1">{nav.map(([to,label,Icon,badge])=>{const isActive=active(to);return <Link key={to} to={to} className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${isActive?'bg-accent-muted-strong text-accent shadow-sm shadow-accent/5':'text-fg-muted hover:bg-white/5 hover:text-fg'}`}><Icon size={19} className={isActive?'text-accent':'text-fg-muted group-hover:text-fg transition'}/><span className="flex-1">{label}</span>{badge!=null&&badge>0&&<span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white px-1">{badge>99?'99+':badge}</span>}</Link>})}</nav>{isGuest?<div className="card p-3 mt-2"><p className="text-sm font-semibold text-fg">Mode Tamu</p><p className="text-xs text-fg-muted mt-1 mb-3">Masuk untuk mengikuti lomba dan menyimpan progres.</p><Link to="/register"><Button fullWidth size="sm" className="mb-2" icon={<UserPlus size={15}/>}>Daftar Gratis</Button></Link><Link to="/login"><Button fullWidth size="sm" variant="outline" icon={<LogIn size={15}/>}>Masuk</Button></Link></div>:user?<div className="mt-2 space-y-2 border-t surface-border pt-3"><Link to={profilePath} className="group flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:bg-white/5"><Avatar name={user.displayName} id={user.id} size={40} src={user.profilePhoto||undefined}/><div className="min-w-0 flex-1"><p className="text-sm text-fg font-semibold truncate group-hover:text-accent transition">{user.displayName}</p><div className="flex items-center gap-2 mt-0.5"><p className="text-[11px] text-fg-muted truncate">@{user.username}</p><span className="text-[11px] font-bold text-accent tabular-nums">{user.points.toLocaleString('id-ID')} XP</span></div></div><RankBadge rank={user.rank} size="sm"/></Link><div className="flex items-center gap-2"><ThemeToggle className="flex-1"/><button onClick={logoutNow} className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-sm text-fg-muted hover:bg-red-500/10 hover:text-red-400 transition-all duration-150"><LogOut size={16}/><span>Keluar</span></button></div></div>:null}</aside><div className="md:hidden fixed top-0 left-0 right-0 z-40 glass border-b surface-border px-4 py-3 flex justify-between items-center"><Link to="/home" className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center"><GraduationCap size={16} className="text-fg"/></div><b className="text-fg text-sm">sykabelajar</b></Link><div className="flex items-center gap-1.5"><ThemeToggle/><button onClick={()=>setDrawerOpen(true)} className="relative p-1.5"><Menu size={21} className="text-fg"/></button></div></div>{drawerOpen&&<div className="md:hidden fixed inset-0 z-50"><div className="absolute inset-0 bg-black/70" onClick={()=>setDrawerOpen(false)}/><div className="absolute left-0 top-0 bottom-0 w-72 surface-card-bg border-r surface-border p-4 flex flex-col"><div className="flex justify-between items-center mb-5"><b className="text-fg font-display">Menu</b><button onClick={()=>setDrawerOpen(false)} className="text-fg-muted hover:text-fg p-1">✕</button></div><nav className="space-y-0.5 flex-1 overflow-y-auto">{nav.map(([to,label,Icon,badge])=>{const isActive=active(to);return <Link key={to} to={to} onClick={()=>setDrawerOpen(false)} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${isActive?'bg-accent-muted-strong text-accent':'text-fg-muted hover:bg-white/5 hover:text-fg'}`}><Icon size={18}/><span className="flex-1">{label}</span>{badge!=null&&badge>0&&<span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white px-1">{badge>99?'99+':badge}</span>}</Link>})}</nav></div></div>}<main className="flex-1 min-w-0 pt-14 md:pt-0 pb-16 md:pb-0 surface-bg"><Outlet/></main></div>{!isGuest&&user&&<nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t surface-border px-2 py-1.5 flex items-center justify-around safe-area-bottom">{mobileNav.map(([to,label,Icon,badge])=><Link key={to} to={to} className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition ${active(to)?'text-accent':'text-fg-muted'}`}><Icon size={20}/><span className="text-[10px] font-medium">{label}</span>{badge!=null&&badge>0&&<span className="absolute -top-0.5 right-0 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-bold rounded-full bg-red-500 text-white px-0.5">{badge>99?'99+':badge}</span>}</Link>)}</nav>}</>;
}

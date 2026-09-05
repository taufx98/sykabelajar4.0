import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LayoutDashboard, Trophy, Users, FileText, ShoppingBag, Store, Coins, Settings, ShieldCheck, ClipboardList, Megaphone, Award, Wrench, CreditCard, Banknote } from 'lucide-react';

type AdminNavItem = {
  title: string;
  path: string;
  icon: typeof LayoutDashboard;
  badge?: string;
};

const ITEMS: AdminNavItem[] = [
  { title: 'Lomba', path: '/admin/core?tab=competitions', icon: Trophy },
  { title: 'Pengguna', path: '/admin/core?tab=users', icon: Users },
  { title: 'Pesanan', path: '/admin/core?tab=orders', icon: ShoppingBag },
  { title: 'Shop', path: '/admin/core?tab=shop', icon: Store, badge: 'Core' },
  { title: 'Postingan', path: '/admin/core?tab=posts', icon: FileText },
  { title: 'XP & Coin', path: '/admin/currency', icon: Coins },
  { title: 'Banner Iklan', path: '/admin/banners', icon: Megaphone },
  { title: 'Penghargaan', path: '/admin/awards', icon: Award },
  { title: 'Tugas Harian', path: '/admin/daily-tasks', icon: ClipboardList },
  { title: 'Metode Pembayaran', path: '/admin/payment-settings', icon: Banknote, badge: 'QRIS' },
  { title: 'Moderasi', path: '/admin/moderation', icon: ShieldCheck },
  { title: 'Fulfillment', path: '/admin/fulfillment', icon: Wrench },
  { title: 'Pengaturan Sosial & Notifikasi', path: '/admin/social-notification-settings', icon: Settings },
  { title: 'Role & Akses', path: '/admin/roles', icon: ShieldCheck },
];

const SIDEBAR_ADMIN_PATHS = ['/admin/chat', '/admin/organizers', '/admin/plan-usage'];

export function shouldShowAdminModuleNav(pathname: string) {
  return pathname === '/admin' || pathname === '/admin/core' || (pathname.startsWith('/admin/') && !SIDEBAR_ADMIN_PATHS.includes(pathname));
}

export function AdminModuleNav() {
  const location = useLocation();
  const navRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = () => {
    const node = navRef.current;
    if (!node) return;
    setCanLeft(node.scrollLeft > 4);
    setCanRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 4);
  };

  useEffect(() => {
    updateEdges();
    const node = navRef.current;
    if (!node) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    window.addEventListener('resize', updateEdges);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateEdges);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  const scroll = (direction: 'left' | 'right') => {
    const node = navRef.current;
    if (!node) return;
    node.scrollBy({
      left: direction === 'right' ? Math.max(220, node.clientWidth * 0.72) : -Math.max(220, node.clientWidth * 0.72),
      behavior: 'smooth',
    });
    window.setTimeout(updateEdges, 250);
  };

  const isActive = (path: string) => {
    const [pathname, query] = path.split('?');
    if (location.pathname !== pathname) return false;
    if (!query) return true;
    const target = new URLSearchParams(query).get('tab');
    return new URLSearchParams(location.search).get('tab') === target;
  };

  return <div className="border-y surface-border bg-surface-elevated/20">
    <div className="mx-auto flex max-w-7xl items-center gap-1 px-3 py-1.5 md:px-6">
      {canLeft && <button type="button" aria-label="Panel sebelumnya" onClick={() => scroll('left')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border surface-border bg-surface-card-bg text-slate-400 transition hover:text-fg"><ChevronLeft size={16} /></button>}
      <div ref={navRef} onScroll={updateEdges} className="flex min-w-0 flex-1 gap-1 overflow-x-auto no-scrollbar scroll-smooth">
        <Link to="/admin" className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${location.pathname === '/admin' ? 'bg-moss-500/15 text-accent' : 'text-slate-500 hover:bg-white/5 hover:text-fg-secondary'}`}><LayoutDashboard size={14} />Dashboard</Link>
        {ITEMS.map(({ title, path, icon: Icon, badge }) => <Link key={title} to={path} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${isActive(path) ? 'bg-moss-500/15 text-accent' : 'text-slate-500 hover:bg-white/5 hover:text-fg-secondary'}`}><Icon size={14} /><span>{title}</span>{badge && <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-accent">{badge}</span>}</Link>)}
      </div>
      {canRight && <button type="button" aria-label="Panel berikutnya" onClick={() => scroll('right')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border surface-border bg-surface-card-bg text-slate-400 transition hover:text-fg"><ChevronRight size={16} /></button>}
    </div>
  </div>;
}

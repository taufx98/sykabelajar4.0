import { useEffect, useState } from 'react';
import { LayoutDashboard, Trophy, Users, FileText, ShoppingBag, Store, Coins, Settings, ShieldCheck, ClipboardList, Megaphone, Award, Wrench, Banknote, Medal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

type AdminNavItem = { title: string; path: string; icon: typeof LayoutDashboard; badge?: string };
type AdminNavGroup = { key: string; title: string; items: AdminNavItem[] };

const GROUPS: AdminNavGroup[] = [
  { key: 'operational', title: 'Operasional Utama', items: [
    { title: 'Lomba', path: '/admin/core?tab=competitions', icon: Trophy },
    { title: 'Pengguna', path: '/admin/core?tab=users', icon: Users },
    { title: 'Pesanan', path: '/admin/core?tab=orders', icon: ShoppingBag },
    { title: 'Shop', path: '/admin/core?tab=shop', icon: Store },
    { title: 'Postingan', path: '/admin/core?tab=posts', icon: FileText },
  ] },
  { key: 'platform', title: 'Platform & Konten', items: [
    { title: 'XP & Coin', path: '/admin/currency', icon: Coins },
    { title: 'Banner Iklan', path: '/admin/banners', icon: Megaphone },
    { title: 'Penghargaan', path: '/admin/awards', icon: Award },
    { title: 'Badge', path: '/admin/badges', icon: Medal },
    { title: 'Tugas Harian', path: '/admin/daily-tasks', icon: ClipboardList },
  ] },
  { key: 'access', title: 'Akses, Paket & Keamanan', items: [
    { title: 'Metode Pembayaran', path: '/admin/payment-settings', icon: Banknote },
    { title: 'Moderasi', path: '/admin/moderation', icon: ShieldCheck },
    { title: 'Fulfillment', path: '/admin/fulfillment', icon: Wrench },
    { title: 'Pengaturan Sosial & Notifikasi', path: '/admin/social-notification-settings', icon: Settings },
    { title: 'Role & Akses', path: '/admin/roles', icon: ShieldCheck },
  ] },
];

const MODULE_NAV_HIDDEN_PATHS = ['/admin/chat', '/admin/organizers', '/admin/plan-usage', '/admin/error-intelligence'];

export function shouldShowAdminModuleNav(pathname: string) {
  return pathname.startsWith('/admin') && !MODULE_NAV_HIDDEN_PATHS.includes(pathname);
}

function matchesItem(location: ReturnType<typeof useLocation>, path: string) {
  const [pathname, query] = path.split('?');
  if (location.pathname !== pathname) return false;
  if (!query) return true;
  return new URLSearchParams(location.search).get('tab') === new URLSearchParams(query).get('tab');
}

function groupForLocation(location: ReturnType<typeof useLocation>) {
  return GROUPS.find(group => group.items.some(item => matchesItem(location, item.path)))?.key ?? null;
}

export function AdminModuleNav() {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState(() => groupForLocation(location));
  const activeGroup = groupForLocation(location);

  useEffect(() => { setOpenGroup(activeGroup); }, [activeGroup]);

  const selectedGroup = GROUPS.find(group => group.key === openGroup) ?? null;
  const gridClass = selectedGroup?.items.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-5';

  return <nav className="border-b surface-border bg-surface-elevated/15" aria-label="Navigasi modul Admin">
    <div className="mx-auto max-w-7xl px-3 py-2 md:px-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <Link to="/admin" className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${!openGroup && location.pathname === '/admin' ? 'bg-accent-muted-strong text-accent shadow-sm' : 'text-slate-500 hover:bg-white/5 hover:text-fg-secondary'}`}><LayoutDashboard size={14} /><span className="truncate">Dashboard</span></Link>
        {GROUPS.map(group => <button key={group.key} type="button" onClick={() => setOpenGroup(value => value === group.key ? null : group.key)} className={`flex min-w-0 items-center justify-center rounded-xl px-2 py-2 text-xs font-semibold transition-all duration-200 ${openGroup === group.key ? 'bg-accent-muted-strong text-accent shadow-sm' : 'text-slate-500 hover:bg-white/5 hover:text-fg-secondary'}`} aria-expanded={openGroup === group.key}><span className="truncate">{group.title}</span></button>)}
      </div>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${selectedGroup ? 'mt-2 max-h-40 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1'}`}>
        {selectedGroup && <div className={`grid ${gridClass} gap-1.5 pb-1`}>{selectedGroup.items.map(({ title, path, icon: Icon }) => <Link key={title} to={path} className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-all duration-200 ${matchesItem(location, path) ? 'border-accent/20 bg-accent-muted-strong text-accent shadow-sm' : 'border-transparent text-slate-500 hover:border-surface-border hover:bg-white/5 hover:text-fg-secondary'}`}><Icon size={14} /><span className="truncate">{title}</span></Link>)}</div>}
      </div>
    </div>
  </nav>;
}

import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { AdminCommunicationLinks } from '@/components/admin/AdminCommunicationLinks';
import { notifyHomeNavigationClick } from '@/lib/homeNavigation';
import { useLanguage } from '@/lib/LanguageContext';

export type GlobalHeaderNavItem = { to: string; label: string; icon: LucideIcon };
type GlobalHeaderProps = { navItems: GlobalHeaderNavItem[]; badgeLabel?: string };

function scoreMatch(itemPath: string, pathname: string) {
  const path = itemPath.split('?')[0].replace(/\/$/, '') || '/';
  const current = pathname.replace(/\/$/, '') || '/';
  if (current === path) return path.length + 1000;
  if (path.startsWith('/profile/@') && current.startsWith('/profile/')) return path.length;
  if (path !== '/' && current.startsWith(`${path}/`)) return path.length;
  return -1;
}

function resolveActiveItem(navItems: GlobalHeaderNavItem[], pathname: string) {
  return navItems.reduce<GlobalHeaderNavItem | null>((best, item) => {
    const itemScore = scoreMatch(item.to, pathname);
    if (itemScore < 0) return best;
    const bestScore = best ? scoreMatch(best.to, pathname) : -1;
    return itemScore > bestScore ? item : best;
  }, null);
}

export function GlobalHeader({ navItems, badgeLabel }: GlobalHeaderProps) {
  const location = useLocation();
  const { user } = useApp();
  const { language, t } = useLanguage();
  if (location.pathname === '/' || location.pathname === '/home') return null;

  const activeItem = resolveActiveItem(navItems, location.pathname);
  const isAdminChat = location.pathname === '/admin/chat';
  const isAdminBadges = location.pathname === '/admin/badges';
  const isDailyTasks = location.pathname === '/daily-tasks';
  const label = isAdminChat
    ? 'Kontrol Admin'
    : isAdminBadges
      ? 'Badge'
      : isDailyTasks
        ? 'Daily Tasks & Referral'
        : activeItem?.label ?? 'SYKABELAJAR';
  const showAdminCommunication = user?.role === 'admin'
    && (location.pathname === '/pesan' || isAdminChat);
  const roleBadge = user?.role === 'admin' ? 'Admin' : badgeLabel;
  const dateLabel = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 dark:border-[#1E293B] dark:bg-[#0B1120] sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/home"
          onClick={() => notifyHomeNavigationClick('/home')}
          aria-label={t('header.back')}
          title={t('header.back')}
          className="md:hidden inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ArrowLeft size={21} aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 truncate text-lg font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-xl">
          {label}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-[#1E293B] dark:bg-slate-900 dark:text-slate-400 sm:inline-flex">
          <CalendarDays size={13} className="text-[#3B82F6]" />
          {dateLabel}
        </span>
        {showAdminCommunication && <AdminCommunicationLinks />}
        {roleBadge && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#2563EB] dark:text-[#93C5FD]">
            <i aria-hidden="true" className="fa-solid fa-user-shield" />
            {roleBadge}
          </span>
        )}
      </div>
    </header>
  );
}

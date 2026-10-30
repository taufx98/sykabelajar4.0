import { useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  Home,
  MessageCircle,
  School,
  ShieldCheck,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';
import { useLanguage } from '@/lib/LanguageContext';
import { notifyHomeNavigationClick } from '@/lib/homeNavigation';

const DEFAULT_MOBILE_NAV = ['home', 'leaderboard', 'awards', 'chat'];
const MOBILE_NAV_KEYS = new Set([
  'home', 'workspace', 'leaderboard', 'awards', 'chat', 'notifications', 'profile', 'admin', 'organizer', 'teacher', 'portal',
]);

function normalizeMobileNav(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_MOBILE_NAV];
  const savedItems = value.map(String).filter((key) => MOBILE_NAV_KEYS.has(key)).slice(0, 5);
  return savedItems.length ? savedItems : [...DEFAULT_MOBILE_NAV];
}

type MobileNavigationItem = {
  label: string;
  to: string;
  icon: LucideIcon;
};

export function MobileNavigationOverride({
  unreadChatCount = 0,
  unreadNotificationCount = 0,
}: {
  unreadChatCount?: number;
  unreadNotificationCount?: number;
}) {
  const { user, isGuest } = useApp();
  const { t } = useLanguage();
  const location = useLocation();
  const [items, setItems] = useState<string[]>(DEFAULT_MOBILE_NAV);
  const collectiveMode =
    !user &&
    !isGuest &&
    typeof window !== 'undefined' &&
    Boolean(window.sessionStorage.getItem('syka_collective_access_token'));

  useEffect(() => {
    if (!user || isGuest || collectiveMode) return;
    let active = true;

    void supabase
      .from('profile_ui_settings')
      .select('mobile_nav')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !Array.isArray(data?.mobile_nav)) return;
        setItems(normalizeMobileNav(data.mobile_nav));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [user?.id, isGuest, collectiveMode]);

  useEffect(() => {
    if (!user || isGuest || collectiveMode) return;

    const channel = supabase
      .channel(`mobile-ui-settings-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profile_ui_settings',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setItems([...DEFAULT_MOBILE_NAV]);
            return;
          }
          const savedItems = (payload.new as { mobile_nav?: unknown }).mobile_nav;
          setItems(normalizeMobileNav(savedItems));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, isGuest, collectiveMode]);

  if (isGuest || (!user && !collectiveMode)) return null;

  const workspaceItem: MobileNavigationItem =
    user?.role === 'admin'
      ? { label: t('nav.admin'), to: '/admin', icon: ShieldCheck }
      : user?.role === 'penyelenggara'
        ? { label: t('nav.organizer'), to: '/organizer', icon: Building2 }
        : user?.role === 'guru'
          ? { label: t('nav.teacher'), to: '/guru', icon: School }
          : { label: t('nav.dailyTasks'), to: '/daily-tasks', icon: CalendarCheck };

  const profilePath = user?.username ? `/profile/@${user.username}` : '/profile';
  const navigationItems: Record<string, MobileNavigationItem> = {
    home: { label: t('nav.home'), to: '/home', icon: Home },
    workspace: workspaceItem,
    leaderboard: { label: t('nav.leaderboard'), to: '/leaderboard', icon: BarChart3 },
    awards: { label: t('nav.awards'), to: '/awards', icon: Award },
    chat: { label: t('nav.messages'), to: '/pesan', icon: MessageCircle },
    notifications: { label: t('nav.notifications'), to: '/notifications', icon: Bell },
    profile: { label: t('nav.profile'), to: profilePath, icon: UserIcon },
    admin: { label: t('nav.admin'), to: '/admin', icon: ShieldCheck },
    organizer: { label: t('nav.organizer'), to: '/organizer', icon: Building2 },
    teacher: { label: t('nav.teacher'), to: '/guru', icon: School },
    portal: { label: t('nav.portal'), to: '/peserta-kolektif', icon: School },
  };

  const visibleKeys = collectiveMode ? ['portal', 'chat'] : items;
  return (
    <nav
      aria-label="Navigasi bawah mobile"
      data-testid="mobile-bottom-navigation"
      className="fixed bottom-0 left-0 right-0 z-[80] flex md:hidden glass border-t surface-border px-2 py-1.5 justify-around safe-area-bottom-syka"
    >
      {visibleKeys.map((key) => {
        const item = navigationItems[key];
        if (!item) return null;
        const Icon = item.icon;
        const isActive =
          location.pathname === item.to ||
          (item.to === '/home' && location.pathname === '/') ||
          (item.to !== '/home' && location.pathname.startsWith(`${item.to}/`));
        const badge = key === 'chat' ? unreadChatCount : key === 'notifications' ? unreadNotificationCount : 0;

        return (
          <Link
            key={key}
            to={item.to}
            onClick={() => notifyHomeNavigationClick(item.to)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl ${isActive ? 'text-accent' : 'text-fg-muted'}`}
          >
            <Icon size={20} />
            <span className="text-[10px] truncate">{item.label}</span>
            {badge > 0 && (
              <span className="absolute top-0.5 right-1/4 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

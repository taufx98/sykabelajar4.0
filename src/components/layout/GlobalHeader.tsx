import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, CalendarDays, Medal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { AdminCommunicationLinks } from '@/components/admin/AdminCommunicationLinks';
import { notifyHomeNavigationClick } from '@/lib/homeNavigation';
import { useLanguage } from '@/lib/LanguageContext';

export type GlobalHeaderNavItem = { to: string; label: string; icon: LucideIcon };
type GlobalHeaderProps = { navItems: GlobalHeaderNavItem[]; badgeLabel?: string };
type HeaderMeta = { section: string; subtitle: string };

const META: Record<string, HeaderMeta> = {
  'Lomba Saya': { section: 'Peserta', subtitle: 'Pantau pendaftaran, pengerjaan, hasil, dan piagam lombamu' },
  'Daily Tasks': { section: 'Belajar', subtitle: 'Tugas dan aktivitas harian' },
  'Peringkat': { section: 'Pencapaian', subtitle: 'Lihat posisi dan perkembanganmu' },
  'Piagam': { section: 'Pencapaian', subtitle: 'Koleksi piagam dan penghargaan' },
  'Badge': { section: 'Pencapaian', subtitle: 'Koleksi badge dan pencapaian peserta' },
  'Notifikasi': { section: 'Aktivitas', subtitle: 'Pemberitahuan terbaru untukmu' },
  'Pesanan': { section: 'Transaksi', subtitle: 'Riwayat dan status pesanan' },
  'Guru': { section: 'Guru', subtitle: 'Ruang kerja dan aktivitas guru' },
  'Daftar Kolektif': { section: 'Guru', subtitle: 'Pendaftaran peserta secara kolektif' },
  'Kartu Akses': { section: 'Guru', subtitle: 'Kelola kartu akses peserta' },
  'Monitoring': { section: 'Monitoring', subtitle: 'Pantau aktivitas dan kondisi sistem' },
  'Penyelenggara': { section: 'Penyelenggara', subtitle: 'Kelola organisasi dan kompetisi' },
  'Pasang Iklan': { section: 'Penyelenggara', subtitle: 'Kelola permintaan dan penayangan iklan' },
  'Pesan': { section: 'Komunikasi', subtitle: 'Percakapan dan pesan pengguna' },
  'Kontrol Admin': { section: 'Komunikasi', subtitle: 'Pusat kontrol percakapan admin' },
  'Admin': { section: 'Admin', subtitle: 'Pusat pengelolaan SYKABELAJAR' },
  'Error Intelligence': { section: 'Monitoring', subtitle: 'Pemantauan sistem dan incident' },
  'Plan & Usage': { section: 'Admin', subtitle: 'Penggunaan paket dan kapasitas' },
  'Organisasi': { section: 'Admin', subtitle: 'Manajemen penyelenggara' },
  'Profil': { section: 'Akun', subtitle: 'Kelola profil dan informasi akun' },
  'Portal Peserta': { section: 'Peserta', subtitle: 'Ruang kerja peserta kolektif' },
};

const META_EN: Record<string, HeaderMeta> = {
  'My Competitions': { section: 'Participant', subtitle: 'Track registrations, exams, results, and certificates' },
  'Daily Tasks': { section: 'Learning', subtitle: 'Daily assignments and activities' },
  'Leaderboard': { section: 'Achievements', subtitle: 'Track your progress and ranking' },
  'Awards': { section: 'Achievements', subtitle: 'Your awards and certificates' },
  'Badges': { section: 'Achievements', subtitle: 'Badges and participant achievements' },
  'Notifications': { section: 'Activity', subtitle: 'Your latest updates' },
  'Orders': { section: 'Transactions', subtitle: 'Order status and history' },
  'Teacher': { section: 'Teacher', subtitle: 'Teacher workspace and activities' },
  'Group Registration': { section: 'Teacher', subtitle: 'Register participants in groups' },
  'Access Cards': { section: 'Teacher', subtitle: 'Manage participant access cards' },
  'Monitoring': { section: 'Monitoring', subtitle: 'Monitor activity and system health' },
  'Organizer': { section: 'Organizer', subtitle: 'Manage organizations and competitions' },
  'Advertise': { section: 'Organizer', subtitle: 'Manage advertising requests and placements' },
  'Messages': { section: 'Communication', subtitle: 'Conversations and messages' },
  'Admin Controls': { section: 'Communication', subtitle: 'Admin conversation control center' },
  'Admin': { section: 'Admin', subtitle: 'Manage the SYKABELAJAR platform' },
  'Error Intelligence': { section: 'Monitoring', subtitle: 'Incidents, errors and diagnostics' },
  'Plan & Usage': { section: 'Admin', subtitle: 'Plan and resource usage' },
  'Organizations': { section: 'Admin', subtitle: 'Organization management' },
  'Profile': { section: 'Account', subtitle: 'Manage account information' },
  'Portal': { section: 'Participants', subtitle: 'Participant workspace' },
};

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

function fallbackMeta(label: string): HeaderMeta {
  return { section: 'SYKABELAJAR', subtitle: label === 'SYKABELAJAR' ? 'Ruang kerja SYKABELAJAR' : `Halaman ${label.toLowerCase()}` };
}

export function GlobalHeader({ navItems, badgeLabel }: GlobalHeaderProps) {
  const location = useLocation();
  const { user } = useApp();
  const { language, t } = useLanguage();
  if (location.pathname === '/' || location.pathname === '/home') return null;

  const activeItem = resolveActiveItem(navItems, location.pathname);
  const isAdminChat = location.pathname === '/admin/chat';
  const isAdminBadges = location.pathname === '/admin/badges';
  const label = isAdminChat ? 'Kontrol Admin' : isAdminBadges ? 'Badge' : activeItem?.label ?? 'SYKABELAJAR';
  const Icon = isAdminBadges ? Medal : activeItem?.icon;
  const meta = (language === 'en' ? META_EN[label] : META[label]) ?? (language === 'en' ? { section: 'SYKABELAJAR', subtitle: label === 'SYKABELAJAR' ? 'SYKABELAJAR workspace' : `${label} page` } : fallbackMeta(label));
  const showAdminCommunication = user?.role === 'admin' && (location.pathname === '/pesan' || isAdminChat);

  if (location.pathname === '/daily-tasks') {
    const dateLabel = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(new Date());

    return (
      <header className="sticky top-0 z-30 flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-[#1E293B] dark:bg-[#0B1120] sm:px-6">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Belajar</span>
            <i aria-hidden="true" className="fa-solid fa-chevron-right text-[10px] text-slate-400 dark:text-slate-500" />
            <span className="text-slate-700 dark:text-slate-200">Daily Tasks &amp; Referral</span>
          </div>
          <h1 className="truncate text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">Daily Tasks &amp; Program Referral</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-[#1E293B] dark:bg-slate-900 dark:text-slate-400 sm:inline-flex">
            <CalendarDays size={13} className="text-[#3B82F6]"/>
            {dateLabel}
          </span>
          {user?.role === 'admin' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#2563EB] dark:text-[#93C5FD]">
              <i aria-hidden="true" className="fa-solid fa-user-shield"/>
              Admin
            </span>
          )}
        </div>
      </header>
    );
  }

  if (location.pathname === '/notifications') {
    return (
      <header className="notifications-global-header sticky top-0 z-30 flex h-[76px] shrink-0 items-center justify-between border-b border-[#1E293B] bg-[#0B1120] px-5 sm:px-6">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>Aktivitas</span>
            <i aria-hidden="true" className="fa-solid fa-chevron-right text-[10px] text-slate-500" />
            <span className="text-slate-200">Notifikasi</span>
          </div>
          <h1 className="truncate text-xl font-extrabold tracking-tight text-white">Notifikasi</h1>
        </div>
        {user?.role === 'admin' && (
          <span className="ml-4 inline-flex shrink-0 items-center gap-2 rounded-full border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-3 py-1.5 text-[11px] font-bold text-slate-200">
            <i aria-hidden="true" className="fa-solid fa-user-shield text-[#CBD5E1]" />
            Admin
          </span>
        )}
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 glass border-b surface-border">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/home" onClick={() => notifyHomeNavigationClick("/home")} className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg shrink-0"><ArrowLeft size={13} /><span className="hidden sm:inline">{t('header.back')}</span></Link>
          {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon size={16} /></span>}
          <div className="min-w-0"><p className="text-[10px] text-accent font-semibold uppercase tracking-[0.16em] truncate">{meta.section}</p><h1 className="font-display text-lg font-bold text-fg truncate">{label}</h1><p className="hidden md:block text-[10px] text-fg-muted truncate">{meta.subtitle}</p></div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">{showAdminCommunication && <AdminCommunicationLinks />}{badgeLabel && <Badge color="moss">{badgeLabel}</Badge>}</div>
      </div>
    </header>
  );
}

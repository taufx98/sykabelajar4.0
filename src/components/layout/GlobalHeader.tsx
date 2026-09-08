import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';

export type GlobalHeaderNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

type GlobalHeaderProps = {
  navItems: GlobalHeaderNavItem[];
  badgeLabel?: string;
};

type HeaderMeta = {
  section: string;
  subtitle: string;
};

const META: Record<string, HeaderMeta> = {
  'Daily Tasks': { section: 'Belajar', subtitle: 'Tugas dan aktivitas harian' },
  'Peringkat': { section: 'Pencapaian', subtitle: 'Lihat posisi dan perkembanganmu' },
  'Piagam': { section: 'Pencapaian', subtitle: 'Koleksi piagam dan penghargaan' },
  'Notifikasi': { section: 'Aktivitas', subtitle: 'Pemberitahuan terbaru untukmu' },
  'Pesanan': { section: 'Transaksi', subtitle: 'Riwayat dan status pesanan' },
  'Guru': { section: 'Guru', subtitle: 'Ruang kerja dan aktivitas guru' },
  'Daftar Kolektif': { section: 'Guru', subtitle: 'Pendaftaran peserta secara kolektif' },
  'Kartu Akses': { section: 'Guru', subtitle: 'Kelola kartu akses peserta' },
  'Monitoring': { section: 'Monitoring', subtitle: 'Pantau aktivitas dan kondisi sistem' },
  'Penyelenggara': { section: 'Penyelenggara', subtitle: 'Kelola organisasi dan kompetisi' },
  'Pasang Iklan': { section: 'Penyelenggara', subtitle: 'Kelola permintaan dan penayangan iklan' },
  'Pesan': { section: 'Komunikasi', subtitle: 'Percakapan dan pesan pengguna' },
  'Admin': { section: 'Admin', subtitle: 'Pusat pengelolaan SYKABELAJAR' },
  'Error Intelligence': { section: 'Monitoring', subtitle: 'Pemantauan sistem dan incident' },
  'Plan & Usage': { section: 'Admin', subtitle: 'Penggunaan paket dan kapasitas' },
  'Organisasi': { section: 'Admin', subtitle: 'Manajemen penyelenggara' },
  'Profil': { section: 'Akun', subtitle: 'Kelola profil dan informasi akun' },
  'Portal Peserta': { section: 'Peserta', subtitle: 'Ruang kerja peserta kolektif' },
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
  if (location.pathname === '/' || location.pathname === '/home') return null;

  const activeItem = resolveActiveItem(navItems, location.pathname);
  const label = activeItem?.label ?? 'SYKABELAJAR';
  const Icon = activeItem?.icon;
  const meta = META[label] ?? fallbackMeta(label);

  return (
    <header className="sticky top-0 z-30 glass border-b surface-border">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/home" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg shrink-0">
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Kembali</span>
          </Link>
          {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon size={16} /></span>}
          <div className="min-w-0">
            <p className="text-[10px] text-accent font-semibold uppercase tracking-[0.16em] truncate">{meta.section}</p>
            <h1 className="font-display text-lg font-bold text-fg truncate">{label}</h1>
            <p className="hidden md:block text-[10px] text-fg-muted truncate">{meta.subtitle}</p>
          </div>
        </div>
        {badgeLabel && <Badge color="moss">{badgeLabel}</Badge>}
      </div>
    </header>
  );
}

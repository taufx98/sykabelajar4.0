import { LayoutDashboard, ShieldAlert, SlidersHorizontal, Building2, Trophy, Users, FileText, ShoppingBag, Store, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';

type HeaderMeta = { section: string; title: string; subtitle: string; icon: typeof LayoutDashboard };

export function resolveGlobalHeader(location: ReturnType<typeof useLocation>): HeaderMeta {
  if (location.pathname === '/admin/error-intelligence') return { section: 'Monitoring', title: 'Error Intelligence', subtitle: 'Pemantauan sistem dan incident', icon: ShieldAlert };
  if (location.pathname === '/admin/plan-usage') return { section: 'Admin', title: 'Plan & Usage', subtitle: 'Penggunaan paket dan kapasitas', icon: SlidersHorizontal };
  if (location.pathname === '/admin/organizers') return { section: 'Admin', title: 'Organisasi', subtitle: 'Manajemen penyelenggara', icon: Building2 };
  if (location.pathname === '/admin/chat') return { section: 'Komunikasi', title: 'Chat Admin', subtitle: 'Percakapan dan tiket pengguna', icon: ShieldAlert };
  if (location.pathname === '/admin/core') {
    const tab = new URLSearchParams(location.search).get('tab');
    const tabs: Record<string, { title: string; icon: HeaderMeta['icon'] }> = {
      competitions: { title: 'Lomba', icon: Trophy }, users: { title: 'Pengguna', icon: Users }, posts: { title: 'Postingan', icon: FileText },
      orders: { title: 'Pesanan', icon: ShoppingBag }, shop: { title: 'Shop', icon: Store }, settings: { title: 'Pengaturan', icon: Settings },
    };
    const match = tab ? tabs[tab] : null;
    return { section: 'Admin', title: match?.title ?? 'Panel Admin', subtitle: match ? `Kelola ${match.title.toLowerCase()}` : 'Pusat pengelolaan SYKABELAJAR', icon: match?.icon ?? LayoutDashboard };
  }
  return { section: 'Admin', title: 'Panel Admin', subtitle: 'Pusat pengelolaan SYKABELAJAR', icon: LayoutDashboard };
}

export function GlobalHeader({ admin = false }: { admin?: boolean }) {
  const location = useLocation();
  const meta = resolveGlobalHeader(location);
  const Icon = meta.icon;
  if (!admin) return null;
  return <header className="sticky top-0 z-30 glass border-b surface-border">
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/home" className="text-xs text-fg-muted hover:text-fg shrink-0">← Kembali</Link>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon size={16} /></span>
        <div className="min-w-0">
          <p className="text-[10px] text-accent font-semibold uppercase tracking-[0.16em]">{meta.section}</p>
          <h1 className="font-display text-lg font-bold text-fg truncate">{meta.title}</h1>
          <p className="hidden md:block text-[10px] text-fg-muted truncate">{meta.subtitle}</p>
        </div>
      </div>
      <Badge color="moss">ADMIN</Badge>
    </div>
  </header>;
}

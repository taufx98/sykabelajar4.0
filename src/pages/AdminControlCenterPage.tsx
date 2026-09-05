import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LayoutDashboard, Trophy, Users, FileText, ShoppingBag, Store, Building2, MessageCircle, Coins, Settings, ShieldCheck, ClipboardList, Megaphone, Award, Wrench, CreditCard, Banknote } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

interface AdminModule { title: string; description: string; path: string; icon: typeof LayoutDashboard; badge?: string; }
const MODULES: AdminModule[] = [
  { title: 'Lomba', description: 'Kelola kompetisi, status, jadwal, dan publikasi.', path: '/admin/core?tab=competitions', icon: Trophy },
  { title: 'Pengguna', description: 'Moderasi akun, role, profil, status, dan username pengguna.', path: '/admin/core?tab=users', icon: Users },
  { title: 'Organisasi', description: 'Verifikasi dan kelola penyelenggara serta anggota.', path: '/admin/organizers', icon: Building2 },
  { title: 'Chat Customer Service', description: 'Kelola ticket, klaim, penyelesaian, history, dan rating.', path: '/admin/chat', icon: MessageCircle, badge: 'CS' },
  { title: 'Pesanan', description: 'Review pembayaran dan proses pemenuhan pesanan.', path: '/admin/core?tab=orders', icon: ShoppingBag },
  { title: 'Shop', description: 'Atur produk, harga, status aktif, dan katalog.', path: '/admin/core?tab=shop', icon: Store, badge: 'Core' },
  { title: 'Postingan', description: 'Kelola berita, artikel, status, dan publikasi konten.', path: '/admin/core?tab=posts', icon: FileText },
  { title: 'XP & Coin', description: 'Kelola penyesuaian XP dan Coin EDU pengguna.', path: '/admin/currency', icon: Coins },
  { title: 'Banner Iklan', description: 'Kelola banner dan materi promosi platform.', path: '/admin/banners', icon: Megaphone },
  { title: 'Penghargaan', description: 'Kelola badge, medali, sertifikat, dan lifecycle.', path: '/admin/awards', icon: Award },
  { title: 'Tugas Harian', description: 'Kelola judul, reward, periode, dan status task.', path: '/admin/daily-tasks', icon: ClipboardList },
  { title: 'Plan & Usage', description: 'Kelola paket, capability, limit, dan entitlement.', path: '/admin/plan-usage', icon: CreditCard },
  { title: 'Metode Pembayaran', description: 'Kelola Bank Transfer dan QRIS beserta gambar QRIS yang ditampilkan saat checkout.', path: '/admin/payment-settings', icon: Banknote, badge: 'QRIS' },
  { title: 'Moderasi', description: 'Tinjau konten dan tindakan moderasi platform.', path: '/admin/moderation', icon: ShieldCheck },
  { title: 'Fulfillment', description: 'Kelola proses pemenuhan pesanan dan bukti.', path: '/admin/fulfillment', icon: Wrench },
  { title: 'Pengaturan Sosial & Notifikasi', description: 'Atur verification mark dan perilaku notifikasi.', path: '/admin/social-notification-settings', icon: Settings },
  { title: 'Role & Akses', description: 'Atur role detail dan otorisasi admin.', path: '/admin/roles', icon: ShieldCheck },
];

function AdminModuleNav() {
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
    return () => { observer.disconnect(); window.removeEventListener('resize', updateEdges); };
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    const node = navRef.current;
    if (!node) return;
    node.scrollBy({ left: direction === 'right' ? Math.max(220, node.clientWidth * 0.72) : -Math.max(220, node.clientWidth * 0.72), behavior: 'smooth' });
    window.setTimeout(updateEdges, 250);
  };

  return <div className="border-y surface-border bg-surface-elevated/20">
    <div className="mx-auto flex max-w-7xl items-center gap-1 px-3 py-1.5 md:px-6">
      {canLeft && <button type="button" aria-label="Panel sebelumnya" onClick={() => scroll('left')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border surface-border bg-surface-card-bg text-slate-400 transition hover:text-fg"><ChevronLeft size={16}/></button>}
      <div ref={navRef} onScroll={updateEdges} className="flex min-w-0 flex-1 gap-1 overflow-x-auto no-scrollbar scroll-smooth">
        <Link to="/admin" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-moss-500/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-moss-500/20"><LayoutDashboard size={14}/>Dashboard</Link>
        {MODULES.map(({ title, path, icon: Icon, badge }) => <Link key={title} to={path} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-white/5 hover:text-fg-secondary"><Icon size={14}/><span>{title}</span>{badge && <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-accent">{badge}</span>}</Link>)}
      </div>
      {canRight && <button type="button" aria-label="Panel berikutnya" onClick={() => scroll('right')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border surface-border bg-surface-card-bg text-slate-400 transition hover:text-fg"><ChevronRight size={16}/></button>}
    </div>
  </div>;
}

export function AdminControlCenterPage() {
  const _groups = useMemo(() => MODULES.length, []);
  return <div className="min-h-screen surface-bg text-fg-secondary">
    <header className="sticky top-0 z-30 glass border-b surface-border"><div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between"><div className="flex items-center gap-3 min-w-0"><Link to="/home" className="text-xs text-fg-muted hover:text-fg shrink-0">← Kembali</Link><div className="min-w-0"><p className="text-[10px] text-accent font-semibold uppercase tracking-[0.16em]">SYKABELAJAR</p><h1 className="font-display text-lg font-bold text-fg truncate">Panel Admin</h1></div></div><Badge color="moss">ADMIN</Badge></div><AdminModuleNav /></header>
    <main className="max-w-7xl mx-auto px-4 py-4 md:px-6 md:py-5">
      <section className="mb-4"><p className="text-[11px] text-accent font-semibold uppercase tracking-[0.16em]">Control Center</p><h2 className="font-display text-xl md:text-2xl font-bold text-fg mt-1">Pusat Kendali Platform</h2><p className="text-xs md:text-sm text-fg-muted mt-1.5 max-w-3xl">Semua modul administrasi berada dalam satu pusat kendali dengan alur yang konsisten.</p></section>
      <section><AdminDashboard /></section>
      <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3"><div className="flex items-center gap-2"><ShieldCheck size={14} className="text-amber-300"/><p className="text-xs font-semibold text-amber-300">Aturan Admin</p></div><p className="text-[11px] text-fg-muted mt-1">Aksi sensitif divalidasi backend/RLS. UI hanya mengirim aksi, sementara Supabase menentukan hasil akhirnya.</p></div>
      {_groups < 0 && null}
    </main>
  </div>;
}

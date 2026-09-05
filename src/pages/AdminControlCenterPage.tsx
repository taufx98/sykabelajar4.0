import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Trophy, Users, FileText, ShoppingBag, Store, Building2, MessageCircle, Coins, Settings, ShieldCheck, ClipboardList, Megaphone, Award, Wrench, CreditCard, Banknote } from 'lucide-react';
import { Card } from '@/components/ui/Card';
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

export function AdminControlCenterPage() {
  const groups = useMemo(() => ({ operasi: MODULES.slice(0, 7), platform: MODULES.slice(7, 12), akses: MODULES.slice(12) }), []);
  return <div className="min-h-screen surface-bg text-fg-secondary">
    <header className="sticky top-0 z-30 glass border-b surface-border"><div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between"><div className="flex items-center gap-3 min-w-0"><Link to="/home" className="text-xs text-fg-muted hover:text-fg shrink-0">← Kembali</Link><div className="min-w-0"><p className="text-[10px] text-accent font-semibold uppercase tracking-[0.16em]">SYKABELAJAR</p><h1 className="font-display text-xl font-bold text-fg truncate">Panel Admin</h1></div></div><Badge color="moss">ADMIN</Badge></div></header>
    <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6"><section><p className="text-xs text-accent font-semibold uppercase tracking-wide">Control Center</p><h2 className="font-display text-2xl md:text-3xl font-bold text-fg mt-1">Pusat Kendali Platform</h2><p className="text-sm text-fg-muted mt-2 max-w-3xl">Semua modul administrasi berada dalam satu pusat kendali dengan alur yang konsisten dan tetap menggunakan design system SykaBelajar.</p></section><section><AdminDashboard /></section>{(['operasi','platform','akses'] as const).map(group=><section key={group}><div className="flex items-center gap-2 mb-3"><h3 className="text-sm font-semibold text-fg">{group==='operasi'?'Operasional Utama':group==='platform'?'Platform & Konten':'Akses, Paket & Keamanan'}</h3><span className="h-px flex-1 bg-white/5"/></div><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{groups[group].map(({title,description,path,icon:Icon,badge})=><Link key={title} to={path} className="group"><Card hover className="h-full p-4 md:p-5 transition-colors"><div className="flex items-start gap-3"><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center shrink-0 group-hover:bg-moss-500/15"><Icon size={19} className="text-accent"/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="text-sm font-semibold text-fg group-hover:text-accent truncate">{title}</h4>{badge&&<Badge color="info">{badge}</Badge>}</div><p className="text-[11px] leading-relaxed text-fg-muted mt-1.5">{description}</p></div><span className="text-fg-muted group-hover:text-accent text-lg">→</span></div></Card></Link>)}</div></section>)}<section className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4"><p className="text-xs font-semibold text-amber-300">Aturan Admin</p><p className="text-[11px] text-fg-muted mt-1">Aksi sensitif divalidasi backend/RLS. UI hanya mengirim aksi, sementara Supabase menentukan hasil akhirnya.</p></section></main>
  </div>;
}

import { ShieldCheck } from 'lucide-react';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export function AdminControlCenterPage() {
  return <div className="min-h-screen surface-bg text-fg-secondary">
    <main className="max-w-7xl mx-auto px-4 py-4 md:px-6 md:py-5">
      <section className="mb-4">
        <p className="text-[11px] text-accent font-semibold uppercase tracking-[0.16em]">Control Center</p>
        <h2 className="font-display text-xl md:text-2xl font-bold text-fg mt-1">Pusat Kendali Platform</h2>
        <p className="text-xs md:text-sm text-fg-muted mt-1.5 max-w-3xl">Semua modul administrasi berada dalam satu pusat kendali dengan alur yang konsisten.</p>
      </section>
      <section><AdminDashboard /></section>
      <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
        <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-amber-300"/><p className="text-xs font-semibold text-amber-300">Aturan Admin</p></div>
        <p className="text-[11px] text-fg-muted mt-1">Aksi sensitif divalidasi backend/RLS. UI hanya mengirim aksi, sementara Supabase menentukan hasil akhirnya.</p>
      </div>
    </main>
  </div>;
}

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { dismissToast, subscribeToasts, type ToastMessage, type ToastType } from '@/lib/toast';

const meta: Record<ToastType, { icon: typeof CheckCircle2; container: string; iconClass: string; title: string }> = {
  success: { icon: CheckCircle2, container: 'border-emerald-400/25 bg-emerald-500/10 shadow-emerald-950/20', iconClass: 'text-emerald-400', title: 'Berhasil' },
  warning: { icon: AlertTriangle, container: 'border-amber-400/25 bg-amber-500/10 shadow-amber-950/20', iconClass: 'text-amber-300', title: 'Perhatian' },
  error: { icon: XCircle, container: 'border-red-400/25 bg-red-500/10 shadow-red-950/20', iconClass: 'text-red-400', title: 'Gagal' },
  info: { icon: Info, container: 'border-sky-400/25 bg-sky-500/10 shadow-sky-950/20', iconClass: 'text-sky-300', title: 'Informasi' },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div className="fixed inset-x-0 top-4 z-[300] flex justify-center px-4 pointer-events-none md:inset-x-auto md:right-4 md:justify-end md:px-0">
      <div className="w-full max-w-sm space-y-2">
        {toasts.map((toast) => {
          const m = meta[toast.type];
          const Icon = m.icon;
          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-xl backdrop-blur-xl animate-slide-up ${m.container}`}
            >
              <div className={`mt-0.5 shrink-0 ${m.iconClass}`}><Icon size={18} strokeWidth={2.2} /></div>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold uppercase tracking-wide ${m.iconClass}`}>{toast.title || m.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-fg">{toast.message}</p>
              </div>
              <button type="button" aria-label="Tutup notifikasi" onClick={() => dismissToast(toast.id)} className="shrink-0 rounded-lg p-1 text-fg-muted hover:bg-white/10 hover:text-fg transition">
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

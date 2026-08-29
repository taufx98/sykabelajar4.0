import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { subscribeToasts, type ToastMessage } from '@/lib/toast';

const icons = {
  success: <CheckCircle size={16} className="text-emerald-400" />,
  error: <XCircle size={16} className="text-red-400" />,
  info: <Info size={16} className="text-sky-400" />,
};

const bgColors = {
  success: 'bg-emerald-500/10 border-emerald-500/20',
  error: 'bg-red-500/10 border-red-500/20',
  info: 'bg-sky-500/10 border-sky-500/20',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm animate-slide-up ${bgColors[t.type]}`}
        >
          {icons[t.type]}
          <p className="text-sm text-white flex-1">{t.message}</p>
        </div>
      ))}
    </div>
  );
}

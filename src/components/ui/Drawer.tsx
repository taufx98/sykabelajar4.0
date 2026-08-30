import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  side?: 'right' | 'bottom';
}

export function Drawer({ open, onClose, title, children, side = 'right' }: DrawerProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className={`absolute card p-0 animate-slide-up max-h-[90vh] overflow-hidden flex flex-col ${
          side === 'right'
            ? 'right-0 top-0 bottom-0 w-full max-w-md rounded-l-2xl rounded-r-none'
            : 'left-0 right-0 bottom-0 max-h-[85vh] rounded-b-none'
        }`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b surface-border">
            <h3 className="font-display font-semibold text-base text-fg">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 dark:hover:bg-white/5 text-slate-400 hover:text-white transition">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto scrollbar-thin px-5 py-4 flex-1">{children}</div>
      </div>
    </div>
  );
}

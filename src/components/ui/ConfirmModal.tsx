import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: 'danger' | 'default';
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  busy = false,
  tone = 'default',
  icon,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <button type="button" aria-label="Tutup" className="absolute inset-0 cursor-default" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-2xl">
        <button type="button" aria-label="Tutup" className="absolute right-3 top-3 rounded-lg p-2 text-fg-muted hover:bg-white/5 hover:text-fg" onClick={onCancel} disabled={busy}>
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-8">
          <div className={`rounded-xl p-2.5 ${tone === 'danger' ? 'bg-red-500/10 text-red-300' : 'bg-accent/10 text-accent'}`}>
            {icon ?? <AlertTriangle size={18} />}
          </div>
          <div>
            <h2 id="confirm-modal-title" className="text-base font-bold text-fg">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button type="button" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

// Global toast notification - can be used anywhere without React context
export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  title?: string;
}

type ToastListener = (toasts: ToastMessage[]) => void;

let _toasts: ToastMessage[] = [];
let _listeners: ToastListener[] = [];

function notify() {
  _listeners.forEach(fn => fn([..._toasts]));
}

/**
 * Keep visual state consistent across the whole application.
 * - success: operation completed
 * - warning: recoverable/validation/system error
 * - error: failed/rejected/forbidden operation
 * - info: neutral informational message
 */
export function classifyToastType(message: string, requested?: ToastType): ToastType {
  if (requested) return requested;
  const text = String(message ?? '').toLowerCase();
  if (/(ditolak|ditolak|rejected|forbidden|unauthorized|access_denied|tidak diizinkan|gagal|failed|failure|error|exception|invalid|expired|blocked|suspend|suspended|duplicate|already exists|not allowed|denied)/i.test(text)) return 'error';
  if (/(periksa|cek|harap|silakan|belum|tidak dapat|tidak tersedia|warning|peringatan|mencapai batas|limit|akan kedaluwarsa|belum lengkap|wajib)/i.test(text)) return 'warning';
  return 'info';
}

export function showToast(message: string, type?: ToastType, title?: string) {
  const id = crypto.randomUUID();
  const finalType = classifyToastType(message, type);
  const finalTitle = title ?? ({
    success: 'Berhasil',
    warning: 'Perhatian',
    error: 'Gagal',
    info: 'Informasi',
  } as const)[finalType];
  _toasts = [..._toasts, { id, message, type: finalType, title: finalTitle }];
  notify();
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id);
    notify();
  }, 4200);
}

export function subscribeToasts(fn: ToastListener) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

export function getToasts() { return _toasts; }

export const toast = {
  success: (msg: string) => showToast(msg, 'success'),
  warning: (msg: string) => showToast(msg, 'warning'),
  error: (msg: string) => showToast(msg, 'error'),
  info: (msg: string) => showToast(msg, 'info'),
};
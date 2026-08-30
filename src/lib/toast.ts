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
 * Semantic fallback for callers that do not explicitly provide a state.
 * success = completed
 * warning = an error/problem that needs attention but is not an explicit rejection/failure
 * error = failed/rejected/forbidden operation
 * info = neutral message
 */
export function classifyToastType(message: string, requested?: ToastType): ToastType {
  if (requested) return requested;
  const text = String(message ?? '').toLowerCase();
  if (/(ditolak|rejected|forbidden|unauthorized|access_denied|tidak diizinkan|gagal|failed|failure|blocked|denied|suspended|duplicate|already exists|not allowed)/i.test(text)) return 'error';
  if (/(error|exception|terjadi kesalahan|ada kesalahan|kendala|warning|peringatan|periksa|cek|harap|silakan|belum|tidak tersedia|mencapai batas|limit|akan kedaluwarsa|belum lengkap|wajib)/i.test(text)) return 'warning';
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
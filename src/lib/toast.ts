// Global toast notification - can be used anywhere without React context
type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

type ToastListener = (toasts: ToastMessage[]) => void;

let _toasts: ToastMessage[] = [];
let _listeners: ToastListener[] = [];

function notify() {
  _listeners.forEach(fn => fn([..._toasts]));
}

export function showToast(message: string, type: ToastType = 'error') {
  const id = crypto.randomUUID();
  _toasts = [..._toasts, { id, message, type }];
  notify();
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id);
    notify();
  }, 4000);
}

export function subscribeToasts(fn: ToastListener) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

export function getToasts() { return _toasts; }

// Convenience methods
export const toast = {
  success: (msg: string) => showToast(msg, 'success'),
  error: (msg: string) => showToast(msg, 'error'),
  info: (msg: string) => showToast(msg, 'info'),
};

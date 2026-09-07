export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
};

type Listener = (request: (ConfirmRequest & { resolve: (value: boolean) => void }) | null) => void;

const listeners = new Set<Listener>();
let active: (ConfirmRequest & { resolve: (value: boolean) => void }) | null = null;

function emit() {
  listeners.forEach((listener) => listener(active));
}

export function subscribeConfirm(listener: Listener) {
  listeners.add(listener);
  listener(active);
  return () => listeners.delete(listener);
}

export function confirm(request: ConfirmRequest): Promise<boolean> {
  if (active) return Promise.resolve(false);
  return new Promise((resolve) => {
    active = { ...request, resolve };
    emit();
  });
}

export function resolveConfirm(value: boolean) {
  const current = active;
  if (!current) return;
  active = null;
  current.resolve(value);
  emit();
}

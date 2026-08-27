export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRupiah(amount: number): string {
  return 'Rp' + amount.toLocaleString('id-ID');
}

export function countdown(target: string): { days: number; hours: number; minutes: number; seconds: number; expired: boolean } {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, expired: false };
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_GRADIENTS = [
  'from-moss-500 to-teal-deep',
  'from-sky-500 to-sky-700',
  'from-amber-500 to-amber-700',
  'from-rose-500 to-rose-700',
  'from-violet-500 to-violet-700',
  'from-emerald-500 to-emerald-700',
];

export function avatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delay = 600): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

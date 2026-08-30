import { Trophy, Medal, Award as AwardIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function RankBadge({ rank, size = 'md' }: { rank: number; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-6 h-6 text-[10px]', md: 'w-8 h-8 text-xs', lg: 'w-10 h-10 text-sm' };
  if (rank === 1) {
    return <div className={`${sizes[size]} rounded-full gradient-moss flex items-center justify-center font-bold text-white shadow-glow`}>{rank}</div>;
  }
  if (rank === 2) {
    return <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-slate-300 to-slate-500 flex items-center justify-center font-bold text-white`}>{rank}</div>;
  }
  if (rank === 3) {
    return <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center font-bold text-white`}>{rank}</div>;
  }
  return <div className={`${sizes[size]} rounded-full surface-elevated border surface-border flex items-center justify-center font-semibold text-white/70 dark:text-fg-secondary`}>{rank}</div>;
}

export function MedalIcon({ rank, size = 24 }: { rank: number; size?: number }) {
  if (rank === 1) return <Trophy size={size} className="text-moss-400" />;
  if (rank === 2) return <Medal size={size} className="text-fg-secondary" />;
  if (rank === 3) return <Medal size={size} className="text-amber-500" />;
  return <AwardIcon size={size} className="text-slate-500" />;
}

export function Badge({ children, color = 'default' }: { children: ReactNode; color?: 'default' | 'moss' | 'warn' | 'err' | 'info' }) {
  const colors = {
    default: 'surface-card-bg text-fg-secondary border surface-border',
    moss: 'bg-accent-muted text-accent border border-accent/20',
    warn: 'bg-amber-500/15 text-amber-600 border border-amber-500/20 dark:text-amber-300',
    err: 'bg-red-500/15 text-red-600 border border-red-500/20 dark:text-red-300',
    info: 'bg-sky-500/15 text-sky-600 border border-sky-500/20 dark:text-sky-300',
  };
  return <span className={`chip ${colors[color]}`}>{children}</span>;
}

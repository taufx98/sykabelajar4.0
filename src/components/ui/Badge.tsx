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
  return <div className={`${sizes[size]} rounded-full bg-ink-700 border border-white/10 flex items-center justify-center font-semibold text-slate-300`}>{rank}</div>;
}

export function MedalIcon({ rank, size = 24 }: { rank: number; size?: number }) {
  if (rank === 1) return <Trophy size={size} className="text-moss-400" />;
  if (rank === 2) return <Medal size={size} className="text-slate-300" />;
  if (rank === 3) return <Medal size={size} className="text-amber-500" />;
  return <AwardIcon size={size} className="text-slate-500" />;
}

export function Badge({ children, color = 'default' }: { children: ReactNode; color?: 'default' | 'moss' | 'warn' | 'err' | 'info' }) {
  const colors = {
    default: 'bg-ink-700 text-slate-300 border border-white/10',
    moss: 'bg-moss-500/15 text-moss-300 border border-moss-500/20',
    warn: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
    err: 'bg-err/15 text-red-300 border border-err/20',
    info: 'bg-sky-500/15 text-sky-300 border border-sky-500/20',
  };
  return <span className={`chip ${colors[color]}`}>{children}</span>;
}

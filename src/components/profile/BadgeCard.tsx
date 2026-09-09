import { Award } from 'lucide-react';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';

export type ProfileBadge = {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  icon_emoji: string | null;
  category: string;
  rarity: string;
  awarded_at: string;
  reason: string;
  award_source: string;
};

const rarityClass: Record<string, string> = {
  Common: 'border-slate-300/60 bg-slate-50/60 dark:bg-slate-900/20',
  Uncommon: 'border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-950/20',
  Rare: 'border-sky-300/60 bg-sky-50/50 dark:bg-sky-950/20',
  Epic: 'border-violet-300/60 bg-violet-50/50 dark:bg-violet-950/20',
  Legendary: 'border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/20',
  Special: 'border-pink-300/60 bg-pink-50/50 dark:bg-pink-950/20',
};

const rarityTextClass: Record<string, string> = {
  Common: 'text-slate-600 dark:text-slate-300',
  Uncommon: 'text-emerald-700 dark:text-emerald-300',
  Rare: 'text-sky-700 dark:text-sky-300',
  Epic: 'text-violet-700 dark:text-violet-300',
  Legendary: 'text-amber-700 dark:text-amber-300',
  Special: 'text-pink-700 dark:text-pink-300',
};

export function BadgeIcon({ badge, size = 60 }: { badge: Pick<ProfileBadge, 'name' | 'icon_url' | 'icon_emoji' | 'id'>; size?: number }) {
  if (badge.icon_url) {
    return <img src={optimizedCloudinaryUrl(badge.icon_url, { width: size * 2, height: size * 2 })} alt={badge.name} width={size} height={size} className="object-contain" loading="lazy" />;
  }
  if (badge.icon_emoji) return <span className="leading-none" style={{ fontSize: Math.max(28, Math.round(size * 0.55)) }} aria-label={badge.name}>{badge.icon_emoji}</span>;
  return <div className="flex items-center justify-center rounded-2xl bg-accent/10 text-accent" style={{ width: size, height: size }}><Award size={Math.round(size * 0.48)} /></div>;
}

export function BadgeCard({ badge, compact = false }: { badge: ProfileBadge; compact?: boolean }) {
  return <article className={`rounded-2xl border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${rarityClass[badge.rarity] ?? rarityClass.Common}`}>
    <div className={`flex ${compact ? 'items-center gap-3' : 'flex-col items-center text-center'} ${compact ? '' : 'min-h-[210px]'} justify-center`}>
      <div className="shrink-0 flex items-center justify-center" style={{ width: compact ? 58 : 88, height: compact ? 58 : 88 }}>
        <BadgeIcon badge={badge} size={compact ? 52 : 80} />
      </div>
      <div className={compact ? 'min-w-0 flex-1' : 'mt-2.5 w-full'}>
        <p className="font-semibold text-sm text-fg truncate">{badge.name}</p>
        <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${rarityTextClass[badge.rarity] ?? rarityTextClass.Common}`}>
          {badge.rarity}
        </div>
        {!compact && <>
          <p className="mt-1.5 text-[11px] text-fg-muted">{new Date(badge.awarded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted line-clamp-3">{badge.description}</p>
        </>}
      </div>
    </div>
  </article>;
}

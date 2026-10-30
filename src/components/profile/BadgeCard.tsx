import { useEffect, useState } from 'react';
import { Award, X } from 'lucide-react';
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
    return <img src={optimizedCloudinaryUrl(badge.icon_url, { width: size * 2 })} alt={badge.name} width={size} height={size} className="object-contain" loading="lazy" />;
  }
  if (badge.icon_emoji) return <span className="leading-none" style={{ fontSize: Math.max(28, Math.round(size * 0.55)) }} aria-label={badge.name}>{badge.icon_emoji}</span>;
  return <div className="flex items-center justify-center rounded-2xl bg-accent/10 text-accent" style={{ width: size, height: size }}><Award size={Math.round(size * 0.48)} /></div>;
}

export function BadgeCard({ badge, compact = false }: { badge: ProfileBadge; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`group flex w-full items-center justify-center rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${rarityClass[badge.rarity] ?? rarityClass.Common}`}
      aria-label={`Lihat detail badge ${badge.name}`}
    >
      <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-950/10 p-2 transition-transform group-hover:scale-105 dark:bg-white/5 sm:h-28 sm:w-28">
        <BadgeIcon badge={badge} size={compact ? 68 : 96} />
      </span>
    </button>

    {open && <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Tutup detail badge" />
      <div role="dialog" aria-modal="true" aria-labelledby={`badge-title-${badge.id}`} className="relative w-full max-w-md overflow-hidden rounded-3xl border surface-border surface-card-bg shadow-2xl">
        <div className="flex items-start justify-between border-b surface-border p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-muted">Detail Badge</p>
            <h3 id={`badge-title-${badge.id}`} className="mt-1 text-xl font-bold text-fg">{badge.name}</h3>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-fg-muted hover:bg-slate-500/10 hover:text-fg" aria-label="Tutup"><X size={18}/></button>
        </div>

        <div className="p-5">
          <div className={`mx-auto flex h-28 w-28 items-center justify-center rounded-3xl border p-3 ${rarityClass[badge.rarity] ?? rarityClass.Common}`}>
            <BadgeIcon badge={badge} size={92} />
          </div>

          <div className="mt-4 text-center">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${rarityTextClass[badge.rarity] ?? rarityTextClass.Common}`}>{badge.rarity}</span>
            <p className="mt-2 text-xs text-fg-muted">Diperoleh {new Date(badge.awarded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>

          <div className="mt-5 space-y-3 rounded-2xl surface-elevated p-4">
            <div><p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Deskripsi</p><p className="mt-1 text-sm leading-relaxed text-fg">{badge.description}</p></div>
            {badge.category && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Kategori</p><p className="mt-1 text-sm text-fg">{badge.category}</p></div>}
            {badge.reason && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Alasan</p><p className="mt-1 text-sm leading-relaxed text-fg">{badge.reason}</p></div>}
            {badge.award_source && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Sumber</p><p className="mt-1 text-sm text-fg">{badge.award_source}</p></div>}
          </div>
        </div>
      </div>
    </div>}
  </>;
}

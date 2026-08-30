import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trophy, Medal, Award, Flame, Star, X, type LucideIcon } from 'lucide-react';
import { getEmblem } from '@/data/demo';
import type { Emblem as EmblemType } from '@/types';

const ICON_MAP: Record<string, LucideIcon> = {
  trophy: Trophy,
  medal: Medal,
  award: Award,
  flame: Flame,
  star: Star,
};

export function EmblemIcon({ emblem, size = 20 }: { emblem: EmblemType; size?: number }) {
  const Icon = ICON_MAP[emblem.icon] || Award;
  return (
    <div
      className={`bg-gradient-to-br ${emblem.color} rounded-lg flex items-center justify-center shadow-sm`}
      style={{ width: size, height: size }}
      title={emblem.name}
    >
      <Icon size={size * 0.6} className="text-fg" />
    </div>
  );
}

export function EmblemBadge({ emblemId, size = 24, onClick }: { emblemId: string; size?: number; onClick?: () => void }) {
  const emblem = getEmblem(emblemId);
  if (!emblem) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="shrink-0 transition-transform hover:scale-110"
      title={emblem.name}
    >
      <EmblemIcon emblem={emblem} size={size} />
    </button>
  );
}

export function EmblemRow({ emblemIds, maxStatic = 5, size = 20 }: { emblemIds: string[]; maxStatic?: number; size?: number }) {
  const [popupEmblem, setPopupEmblem] = useState<EmblemType | null>(null);
  const emblems = emblemIds.map(getEmblem).filter(Boolean) as EmblemType[];

  if (emblems.length === 0) {
    return <span className="text-xs text-slate-600 italic">Belum ada emblem</span>;
  }

  const shouldScroll = emblems.length > maxStatic;

  return (
    <>
      <div className={`flex items-center gap-1.5 ${shouldScroll ? 'overflow-hidden' : 'flex-wrap'}`}>
        {shouldScroll ? (
          <div className="flex gap-1.5 animate-marquee" style={{ animationDuration: `${emblems.length * 2}s` }}>
            {[...emblems, ...emblems].map((e, i) => (
              <EmblemBadge key={e.id + i} emblemId={e.id} size={size} onClick={() => setPopupEmblem(e)} />
            ))}
          </div>
        ) : (
          emblems.map((e) => (
            <EmblemBadge key={e.id} emblemId={e.id} size={size} onClick={() => setPopupEmblem(e)} />
          ))
        )}
      </div>
      <EmblemPopup emblem={popupEmblem} onClose={() => setPopupEmblem(null)} />
    </>
  );
}

export function EmblemPopup({ emblem, onClose }: { emblem: EmblemType | null; onClose: () => void }) {
  useEffect(() => {
    if (!emblem) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [emblem, onClose]);

  if (!emblem) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fade-in" />
      <div
        className="relative card p-6 text-center max-w-xs w-full rounded-2xl border border-moss-500/20 animate-scale-in shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative' }}
      >
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/5 dark:hover:bg-white/5 text-slate-400 transition z-10">
          <X size={16} />
        </button>
        <div className="flex justify-center mb-3">
          <EmblemIcon emblem={emblem} size={56} />
        </div>
        <h3 className="font-display font-bold text-white mb-1">{emblem.name}</h3>
        <p className="text-xs text-slate-500 mb-3">{emblem.position}</p>
        <div className="surface-elevated rounded-xl p-3 text-left">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Didapatkan dari</p>
          <p className="text-sm text-fg font-medium">{emblem.competitionTitle}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ShowcaseEmblems({ emblemIds, size = 16 }: { emblemIds: string[]; size?: number }) {
  const [popupEmblem, setPopupEmblem] = useState<EmblemType | null>(null);
  if (emblemIds.length === 0) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1">
        {emblemIds.map((id) => (
          <EmblemBadge key={id} emblemId={id} size={size} onClick={() => {
            const e = getEmblem(id);
            if (e) setPopupEmblem(e);
          }} />
        ))}
      </div>
      <EmblemPopup emblem={popupEmblem} onClose={() => setPopupEmblem(null)} />
    </>
  );
}

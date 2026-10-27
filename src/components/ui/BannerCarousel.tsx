import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { loadPublicBanners, type PublicBanner } from '@/services/public-banner.service';
import { useApp } from '@/store/AppContext';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';

const UPLOAD_H = 300;
const SLOT_RATIOS: Record<number, string> = {
  1: '465 / 300',
  2: '930 / 300',
  3: '1400 / 300',
};

type BannerGroup = {
  items: Array<{ banner: PublicBanner; widthSlots: number }>;
  usedSlots: number;
};

function getSlotCount() {
  if (typeof window === 'undefined') return 3;
  return window.innerWidth >= 1024 ? 5 : 3;
}

function getBannerWidthSlots(banner: PublicBanner, availableSlots: number): number {
  const value = Number(banner.image_width_slots ?? 1);
  const width = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(availableSlots, width));
}

function EmptySlot() {
  return (
    <Link
      to="/organizer/ads"
      className="w-full min-w-0 surface-elevated border border-dashed surface-border flex flex-col items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-accent/60 transition cursor-pointer rounded-xl"
      style={{ aspectRatio: SLOT_RATIOS[1] }}
    >
      <Megaphone size={22} />
      <span className="text-[11px]">Pasang Iklan</span>
    </Link>
  );
}

function BannerMedia({ banner, className }: { banner: PublicBanner; className?: string }) {
  return (
    <img
      src={optimizedCloudinaryUrl(banner.image_url, { width: 800 })}
      alt={banner.title || 'Banner'}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

export function BannerCarousel() {
  const { user } = useApp();
  const [banners, setBanners] = useState<PublicBanner[]>([]);
  const [currentGroup, setCurrentGroup] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slotCount, setSlotCount] = useState(3);
  const canSeeEmptySlots = user?.role === 'admin' || user?.role === 'guru' || user?.role === 'penyelenggara';

  useEffect(() => {
    const update = () => setSlotCount(getSlotCount());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    setCurrentGroup(0);
  }, [slotCount]);

  useEffect(() => {
    let alive = true;
    void loadPublicBanners().then((items) => {
      if (!alive) return;
      setBanners(items);
      setCurrentGroup(0);
      setLoading(false);
    }).catch(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Pack banners by slot width, not by banner count. A 2-slot banner consumes
  // two columns, while a single-slot banner always stays one column wide.
  const groups: BannerGroup[] = [];
  for (const banner of banners) {
    const widthSlots = getBannerWidthSlots(banner, slotCount);
    let group = groups[groups.length - 1];
    if (!group || group.usedSlots + widthSlots > slotCount) {
      group = { items: [], usedSlots: 0 };
      groups.push(group);
    }
    group.items.push({ banner, widthSlots });
    group.usedSlots += widthSlots;
  }

  const totalGroups = Math.max(groups.length, 1);
  const needsSlide = groups.length > 1;
  const advance = useCallback(() => setCurrentGroup((g) => (g + 1) % totalGroups), [totalGroups]);

  useEffect(() => {
    if (!needsSlide || banners.length === 0) return;
    const timer = setInterval(advance, 45_000);
    return () => clearInterval(timer);
  }, [needsSlide, banners.length, advance]);

  if (loading) {
    return <div className="w-full rounded-xl surface-elevated border surface-border animate-pulse" style={{ aspectRatio: SLOT_RATIOS[1] }} />;
  }

  if (banners.length === 0) {
    if (!canSeeEmptySlots) return null;
    return (
      <div className="grid w-full gap-2" style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}>
        {Array.from({ length: slotCount }).map((_, i) => <EmptySlot key={i} />)}
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <div
        className="flex transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${currentGroup * 100}%)`, width: `${totalGroups * 100}%` }}
      >
        {groups.map((group, gi) => (
          <div
            key={gi}
            className="grid shrink-0 gap-2"
            style={{
              width: `${100 / totalGroups}%`,
              gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))`,
            }}
          >
            {group.items.map(({ banner, widthSlots }) => (
              <a
                key={banner.id}
                href={banner.link_url || '#/home'}
                className="relative min-w-0 rounded-xl overflow-hidden group"
                style={{
                  gridColumn: `span ${widthSlots} / span ${widthSlots}`,
                  aspectRatio: SLOT_RATIOS[widthSlots] ?? SLOT_RATIOS[1],
                }}
              >
                <BannerMedia banner={banner} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              </a>
            ))}
            {canSeeEmptySlots && Array.from({ length: Math.max(0, slotCount - group.usedSlots) }).map((_, ei) => (
              <EmptySlot key={`empty-${gi}-${ei}`} />
            ))}
          </div>
        ))}
      </div>
      {needsSlide && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 rounded-full px-2 py-1">
          {groups.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentGroup(i)}
              className={`rounded-full transition-all ${i === currentGroup ? 'bg-moss-400 w-4 h-1.5' : 'bg-white/30 w-1.5 h-1.5'}`}
              aria-label={`Tampilkan grup iklan ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

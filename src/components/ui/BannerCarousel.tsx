import { useEffect, useState, useCallback } from 'react';
import { Megaphone } from 'lucide-react';
import { loadActiveBanners, type AdBanner } from '@/services/ad.service';

// Fixed dimensions per slot
const SLOT_W = 465;       // 1 slot width
const SLOT_H = 300;       // all slots height
const GAP = 10;            // gap between slots
const FULL_W = SLOT_W * 3 + GAP * 2; // 1415px total (3 slots + 2 gaps)

function EmptySlot({ className = '' }: { className?: string }) {
  return (
    <a
      href="#/admin/banners"
      className={`bg-ink-800/40 border border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-moss-400/60 transition cursor-pointer rounded-xl ${className}`}
      style={{ width: SLOT_W, height: SLOT_H }}
    >
      <Megaphone size={24} />
      <span className="text-xs">Pasang iklan hub. Admin</span>
    </a>
  );
}

export function BannerCarousel() {
  const [banners, setBanners] = useState<AdBanner[]>([]);
  const [currentGroup, setCurrentGroup] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActiveBanners().then((b) => {
      setBanners(b);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Group banners into sets of 3
  const GROUP_SIZE = 3;
  const groups: AdBanner[][] = [];
  for (let i = 0; i < banners.length; i += GROUP_SIZE) {
    groups.push(banners.slice(i, i + GROUP_SIZE));
  }

  const totalGroups = groups.length || 1;
  const needsSlide = banners.length > GROUP_SIZE;

  const advance = useCallback(() => {
    setCurrentGroup((g) => (g + 1) % totalGroups);
  }, [totalGroups]);

  // Auto-slide
  useEffect(() => {
    if (!needsSlide || banners.length === 0) return;
    const duration = banners[0]?.slide_duration_seconds ?? 45;
    const timer = setInterval(advance, duration * 1000);
    return () => clearInterval(timer);
  }, [needsSlide, banners, advance]);

  // Loading skeleton
  if (loading) {
    return (
      <div
        className="rounded-xl bg-ink-800/50 border border-white/5 animate-pulse mx-auto"
        style={{ width: FULL_W, height: SLOT_H, maxWidth: '100%' }}
      />
    );
  }

  // Empty state — 3 placeholder slots
  if (banners.length === 0) {
    return (
      <div className="flex justify-center">
        <div className="flex gap-[10px]">
          {[0, 1, 2].map((i) => (
            <EmptySlot key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Calculate slot width based on single_image banners
  const getSlotWidth = (banner: AdBanner) => {
    if (banner.single_image && banner.image_width_slots > 1) {
      return SLOT_W * banner.image_width_slots + GAP * (banner.image_width_slots - 1);
    }
    return SLOT_W;
  };

  return (
    <div className="flex justify-center">
      <div className="relative overflow-hidden rounded-xl" style={{ width: FULL_W, height: SLOT_H, maxWidth: '100%' }}>
        <div
          className="flex transition-transform duration-700 ease-in-out h-full"
          style={{ transform: `translateX(-${currentGroup * 100}%)`, width: `${totalGroups * 100}%` }}
        >
          {groups.map((group, gi) => (
            <div
              key={gi}
              className="flex gap-[10px] shrink-0 h-full"
              style={{ width: `${100 / totalGroups}%` }}
            >
              {group.map((banner) => (
                <a
                  key={banner.id}
                  href={banner.link_url || '#/home'}
                  className="relative rounded-xl overflow-hidden group shrink-0"
                  style={{
                    width: getSlotWidth(banner),
                    height: SLOT_H,
                  }}
                >
                  <img
                    src={banner.image_url}
                    alt="Banner"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </a>
              ))}
              {/* Fill empty slots in this group */}
              {group.length < GROUP_SIZE &&
                Array.from({ length: GROUP_SIZE - group.length }).map((_, ei) => (
                  <EmptySlot key={`empty-${gi}-${ei}`} />
                ))
              }
            </div>
          ))}
        </div>

        {/* Dots indicator */}
        {needsSlide && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 rounded-full px-2 py-1">
            {groups.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentGroup(i)}
                className={`rounded-full transition-all ${
                  i === currentGroup
                    ? 'bg-moss-400 w-4 h-1.5'
                    : 'bg-white/30 w-1.5 h-1.5'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

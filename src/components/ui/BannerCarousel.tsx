import { useEffect, useState, useCallback } from 'react';
import { Megaphone } from 'lucide-react';
import { loadActiveBanners, type AdBanner } from '@/services/ad.service';

const UPLOAD_H = 300;
const GAP = 8;

function getSlotCount() {
  if (typeof window === 'undefined') return 3;
  return window.innerWidth >= 1024 ? 5 : 3;
}

function EmptySlot() {
  return (
    <a
      href="#/organizer/ads"
      className="flex-1 bg-ink-800/40 border border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-moss-400/60 transition cursor-pointer rounded-xl"
      style={{ aspectRatio: `465/${UPLOAD_H}` }}
    >
      <Megaphone size={22} />
      <span className="text-[11px]">Pasang iklan hub. Admin</span>
    </a>
  );
}

export function BannerCarousel() {
  const [banners, setBanners] = useState<AdBanner[]>([]);
  const [currentGroup, setCurrentGroup] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slotCount, setSlotCount] = useState(3);

  // Detect viewport size
  useEffect(() => {
    const update = () => setSlotCount(getSlotCount());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    loadActiveBanners().then((b) => {
      setBanners(b);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Group banners by visible slot count
  const groups: AdBanner[][] = [];
  for (let i = 0; i < banners.length; i += slotCount) {
    groups.push(banners.slice(i, i + slotCount));
  }

  const totalGroups = groups.length || 1;
  const needsSlide = banners.length > slotCount;

  const advance = useCallback(() => {
    setCurrentGroup((g) => (g + 1) % totalGroups);
  }, [totalGroups]);

  useEffect(() => {
    if (!needsSlide || banners.length === 0) return;
    const duration = banners[0]?.slide_duration_seconds ?? 45;
    const timer = setInterval(advance, duration * 1000);
    return () => clearInterval(timer);
  }, [needsSlide, banners, advance]);

  if (loading) {
    return (
      <div
        className="w-full rounded-xl bg-ink-800/50 border border-white/5 animate-pulse"
        style={{ aspectRatio: `465/${UPLOAD_H}` }}
      />
    );
  }

  if (banners.length === 0) {
    return (
      <div className="w-full flex gap-2">
        {Array.from({ length: slotCount }).map((_, i) => <EmptySlot key={i} />)}
      </div>
    );
  }

  const getSlotFlex = (banner: AdBanner) => {
    if (banner.single_image && banner.image_width_slots > 1) {
      return banner.image_width_slots;
    }
    return 1;
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <div
        className="flex transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${currentGroup * 100}%)`, width: `${totalGroups * 100}%` }}
      >
        {groups.map((group, gi) => (
          <div
            key={gi}
            className="flex gap-2 shrink-0"
            style={{ width: `${100 / totalGroups}%` }}
          >
            {group.map((banner) => (
              <a
                key={banner.id}
                href={banner.link_url || '#/home'}
                className="relative rounded-xl overflow-hidden group shrink-0"
                style={{
                  flex: getSlotFlex(banner),
                  aspectRatio: banner.single_image && banner.image_width_slots > 1
                    ? `${465 * banner.image_width_slots}/${UPLOAD_H}`
                    : `465/${UPLOAD_H}`,
                }}
              >
                <img
                  src={banner.image_url}
                  alt="Banner"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </a>
            ))}
            {group.length < slotCount &&
              Array.from({ length: slotCount - group.length }).map((_, ei) => (
                <EmptySlot key={`empty-${gi}-${ei}`} />
              ))
            }
          </div>
        ))}
      </div>

      {needsSlide && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 rounded-full px-2 py-1">
          {groups.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentGroup(i)}
              className={`rounded-full transition-all ${
                i === currentGroup ? 'bg-moss-400 w-4 h-1.5' : 'bg-white/30 w-1.5 h-1.5'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

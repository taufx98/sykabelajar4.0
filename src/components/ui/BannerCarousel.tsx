import { useEffect, useState, useCallback } from 'react';
import { Megaphone } from 'lucide-react';
import { loadActiveBanners, type AdBanner } from '@/services/ad.service';

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

  if (loading) {
    return (
      <div className="h-20 rounded-xl bg-ink-800/50 border border-white/5 animate-pulse" />
    );
  }

  if (banners.length === 0) {
    // Empty banner area — "pasang iklan" placeholders
    return (
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <a
            key={i}
            href="#/admin/banners"
            className="h-20 rounded-xl bg-ink-800/40 border border-dashed border-white/10 flex items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-moss-400/60 transition cursor-pointer"
          >
            <Megaphone size={14} />
            <span className="text-[11px]">Pasang iklan hub. Admin</span>
          </a>
        ))}
      </div>
    );
  }

  const currentBanners = groups[currentGroup] ?? [];

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div
        className="flex transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${currentGroup * 100}%)` }}
      >
        {groups.map((group, gi) => (
          <div
            key={gi}
            className="w-full grid gap-2 shrink-0"
            style={{
              gridTemplateColumns: `repeat(${GROUP_SIZE}, 1fr)`,
            }}
          >
            {group.map((banner) => (
              <a
                key={banner.id}
                href={banner.link_url || '#/home'}
                className="relative h-20 rounded-xl overflow-hidden group"
                style={
                  banner.single_image && banner.image_width_slots > 1
                    ? { gridColumn: `span ${banner.image_width_slots}` }
                    : undefined
                }
              >
                <img
                  src={banner.image_url}
                  alt="Banner"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </a>
            ))}
            {/* Fill empty slots */}
            {group.length < GROUP_SIZE &&
              Array.from({ length: GROUP_SIZE - group.length }).map((_, ei) => (
                <a
                  key={`empty-${ei}`}
                  href="#/admin/banners"
                  className="h-20 rounded-xl bg-ink-800/40 border border-dashed border-white/10 flex items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-moss-400/60 transition cursor-pointer"
                >
                  <Megaphone size={14} />
                  <span className="text-[11px]">Pasang iklan hub. Admin</span>
                </a>
              ))}
          </div>
        ))}
      </div>

      {/* Dots indicator */}
      {needsSlide && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          {groups.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentGroup(i)}
              className={`w-1.5 h-1.5 rounded-full transition ${
                i === currentGroup ? 'bg-moss-400 w-4' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

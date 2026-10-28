import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { loadPublicBanners, type PublicBanner } from '@/services/public-banner.service';
import { useApp } from '@/store/AppContext';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';
import type { BannerPlacement } from '@/services/ad.service';

const TOP_ASPECT_RATIO = '1200 / 512';
const SIDEBAR_ASPECT_RATIO = '600 / 500';

type BannerGroup = {
  items: Array<{ banner: PublicBanner; widthSlots: number }>;
  usedSlots: number;
};

interface BannerCarouselProps {
  /** Defaults to the existing Home-top placement for callers outside Home. */
  placement?: BannerPlacement;
}

function aspectRatioFor(placement: BannerPlacement, widthSlots = 1, visibleSlots = 1) {
  if (placement === 'home_sidebar') return SIDEBAR_ASPECT_RATIO;
  // Wide creatives span two columns only when both are visible; on mobile
  // preserve the usual single-card height and contain the full creative.
  return widthSlots > 1 && visibleSlots > 1 ? '2400 / 512' : TOP_ASPECT_RATIO;
}

function getBannerWidthSlots(banner: PublicBanner, placement: BannerPlacement, availableSlots: number): number {
  if (placement === 'home_sidebar') return 1;
  const value = Number(banner.image_width_slots ?? 1);
  const width = Number.isFinite(value) ? Math.floor(value) : 1;
  // Home top has a two-slot capacity; older 3-slot records remain visible
  // as full-width items rather than overflowing the new layout.
  return Math.max(1, Math.min(2, availableSlots, width));
}

function EmptySlot({ placement, visible }: { placement: BannerPlacement; visible: boolean }) {
  return (
    <Link
      to="/organizer/ads"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`w-full min-w-0 surface-elevated border border-dashed surface-border flex flex-col items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-accent/60 transition rounded-xl ${visible ? 'cursor-pointer' : 'invisible pointer-events-none'}`}
      style={{ aspectRatio: aspectRatioFor(placement) }}
    >
      <Megaphone size={22} />
      <span className="text-[11px]">Pasang Iklan</span>
    </Link>
  );
}

function BannerMedia({ banner, className }: { banner: PublicBanner; className?: string }) {
  const src = banner.media_type === 'video'
    ? banner.image_url
    : optimizedCloudinaryUrl(banner.image_url, { width: banner.placement === 'home_sidebar' ? 600 : 1200 });
  if (banner.media_type === 'video') {
    return <video src={src} className={className} muted playsInline autoPlay loop preload="metadata" />;
  }
  return (
    <img
      src={src}
      alt={banner.title || 'Banner'}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

export function BannerCarousel({ placement = 'home_top' }: BannerCarouselProps) {
  const { user } = useApp();
  const [banners, setBanners] = useState<PublicBanner[]>([]);
  const [currentGroup, setCurrentGroup] = useState(0);
  const [loading, setLoading] = useState(true);
  // Two top slots on a sufficiently wide content area; one card on narrow
  // screens. The sidebar remains one slot at all breakpoints.
  const [topSlotCount, setTopSlotCount] = useState(2);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const canSeeEmptySlots = user?.role === 'admin' || user?.role === 'guru' || user?.role === 'penyelenggara';
  const slotCount = placement === 'home_sidebar' ? 1 : topSlotCount;
  const aspectRatio = aspectRatioFor(placement, 1, slotCount);

  useEffect(() => {
    if (placement === 'home_sidebar') {
      setTopSlotCount(1);
      return;
    }
    const node = carouselRef.current;
    if (!node) return;
    const update = (width: number) => setTopSlotCount(width >= 640 ? 2 : 1);
    update(node.getBoundingClientRect().width);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) update(entry.contentRect.width);
      });
      observer.observe(node);
      return () => observer.disconnect();
    }

    const handleResize = () => update(node.getBoundingClientRect().width);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [placement]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadPublicBanners(placement).then((items) => {
      if (!alive) return;
      setBanners(items);
      setCurrentGroup(0);
      setLoading(false);
    }).catch(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [placement]);

  const groups = useMemo<BannerGroup[]>(() => {
    const result: BannerGroup[] = [];
    for (const banner of banners) {
      const widthSlots = getBannerWidthSlots(banner, placement, slotCount);
      let group = result[result.length - 1];
      if (!group || group.usedSlots + widthSlots > slotCount) {
        group = { items: [], usedSlots: 0 };
        result.push(group);
      }
      group.items.push({ banner, widthSlots });
      group.usedSlots += widthSlots;
    }
    return result;
  }, [banners, placement, slotCount]);

  const totalGroups = Math.max(groups.length, 1);
  const needsSlide = groups.length > 1;
  const safeCurrentGroup = Math.min(currentGroup, totalGroups - 1);
  const visibleGroup = groups[safeCurrentGroup] ?? groups[0];
  // Reuse each banner's existing configured interval (slide_duration_seconds).
  // The current group interval resets after manual swipe or auto-advance.
  const configuredDurations = visibleGroup?.items.map(({ banner }) => Number(banner.slide_duration_seconds) || 45) ?? [45];
  const slideDurationMs = Math.max(5, Math.min(120, Math.max(...configuredDurations))) * 1000;
  const advance = useCallback(() => setCurrentGroup((g) => (g + 1) % totalGroups), [totalGroups]);
  const previous = useCallback(() => setCurrentGroup((g) => (g - 1 + totalGroups) % totalGroups), [totalGroups]);

  useEffect(() => {
    if (!needsSlide || banners.length === 0) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(advance, slideDurationMs);
    return () => window.clearInterval(timer);
  }, [needsSlide, banners.length, advance, slideDurationMs, safeCurrentGroup]);

  useEffect(() => {
    setCurrentGroup((group) => Math.min(group, Math.max(0, totalGroups - 1)));
  }, [totalGroups]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    suppressClickRef.current = false;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || !needsSlide) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    suppressClickRef.current = true;
    if (deltaX < 0) advance();
    else previous();
  };

  return (
    <div
      ref={carouselRef}
      className={`relative w-full overflow-hidden rounded-xl ${needsSlide ? 'touch-pan-y' : ''}`}
      role="region"
      aria-label={placement === 'home_sidebar' ? 'Iklan sidebar' : 'Iklan utama'}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { dragStartRef.current = null; }}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
    >
      {loading ? (
        <div
          className={`w-full rounded-xl surface-elevated border surface-border animate-pulse ${slotCount === 2 ? 'grid grid-cols-2 gap-2' : ''}`}
        >
          {Array.from({ length: slotCount }).map((_, index) => (
            <div key={index} style={{ aspectRatio }} />
          ))}
        </div>
      ) : banners.length === 0 ? (
        canSeeEmptySlots ? (
          <div className="grid w-full gap-2" style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}>
            {Array.from({ length: slotCount }).map((_, index) => <EmptySlot key={index} placement={placement} />)}
          </div>
        ) : null
      ) : (
        <>
          <div
            className="flex transition-transform duration-700 ease-in-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${safeCurrentGroup * 100}%)`, width: `${totalGroups * 100}%` }}
          >
            {groups.map((group, groupIndex) => (
              <div
                key={groupIndex}
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
                    className="relative min-w-0 rounded-xl overflow-hidden group bg-black/5"
                    style={{
                      gridColumn: `span ${widthSlots} / span ${widthSlots}`,
                      aspectRatio: aspectRatioFor(placement, widthSlots, slotCount),
                    }}
                  >
                    <BannerMedia
                      banner={banner}
                      className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  </a>
                ))}
                {Array.from({ length: Math.max(0, slotCount - group.usedSlots) }).map((_, index) => (
                  <EmptySlot key={`empty-${groupIndex}-${index}`} placement={placement} visible={canSeeEmptySlots} />
                ))}
              </div>
            ))}
          </div>
          {needsSlide && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/45 rounded-full px-2 py-1">
              {groups.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setCurrentGroup(index)}
                  aria-label={`Tampilkan grup iklan ${index + 1}`}
                  aria-current={index === safeCurrentGroup}
                  className={`rounded-full transition-all ${index === safeCurrentGroup ? 'bg-moss-400 w-4 h-1.5' : 'bg-white/45 w-1.5 h-1.5'}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

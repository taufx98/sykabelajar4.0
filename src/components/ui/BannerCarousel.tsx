import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { loadPublicBanners, type PublicBanner } from '@/services/public-banner.service';
import { useApp } from '@/store/AppContext';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';

const UPLOAD_H = 300;

function getSlotCount() {
  if (typeof window === 'undefined') return 3;
  return window.innerWidth >= 1024 ? 5 : 3;
}

function EmptySlot() {
  return (
    <Link to="/organizer/ads" className="flex-1 surface-elevated border border-dashed surface-border flex flex-col items-center justify-center gap-2 text-slate-600 hover:border-moss-500/30 hover:text-accent/60 transition cursor-pointer rounded-xl" style={{ aspectRatio: `465/${UPLOAD_H}` }}>
      <Megaphone size={22} />
      <span className="text-[11px]">Pasang Iklan</span>
    </Link>
  );
}

function BannerMedia({ banner, className }: { banner: PublicBanner; className?: string }) {
  return <img src={optimizedCloudinaryUrl(banner.image_url,{width:800})} alt={banner.title || 'Banner'} className={className} loading="lazy" decoding="async" />;
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

  const groups: PublicBanner[][] = [];
  for (let i = 0; i < banners.length; i += slotCount) groups.push(banners.slice(i, i + slotCount));
  const totalGroups = groups.length || 1;
  const needsSlide = banners.length > slotCount;
  const advance = useCallback(() => setCurrentGroup((g) => (g + 1) % totalGroups), [totalGroups]);

  useEffect(() => {
    if (!needsSlide || banners.length === 0) return;
    const timer = setInterval(advance, 45_000);
    return () => clearInterval(timer);
  }, [needsSlide, banners.length, advance]);

  if (loading) return <div className="w-full rounded-xl surface-elevated border surface-border animate-pulse" style={{ aspectRatio: `465/${UPLOAD_H}` }} />;
  if (banners.length === 0) {
    if (!canSeeEmptySlots) return null;
    return <div className="w-full flex gap-2">{Array.from({ length: slotCount }).map((_, i) => <EmptySlot key={i} />)}</div>;
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <div className="flex transition-transform duration-700 ease-in-out" style={{ transform: `translateX(-${currentGroup * 100}%)`, width: `${totalGroups * 100}%` }}>
        {groups.map((group, gi) => (
          <div key={gi} className="flex gap-2 shrink-0" style={{ width: `${100 / totalGroups}%` }}>
            {group.map((banner) => (
              <a key={banner.id} href={banner.link_url || '#/home'} className="relative rounded-xl overflow-hidden group shrink-0" style={{ flex: 1, aspectRatio: `465/${UPLOAD_H}` }}>
                <BannerMedia banner={banner} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              </a>
            ))}
            {group.length < slotCount && canSeeEmptySlots && Array.from({ length: slotCount - group.length }).map((_, ei) => <EmptySlot key={`empty-${gi}-${ei}`} />)}
          </div>
        ))}
      </div>
      {needsSlide && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 rounded-full px-2 py-1">{groups.map((_, i) => <button key={i} onClick={() => setCurrentGroup(i)} className={`rounded-full transition-all ${i === currentGroup ? 'bg-moss-400 w-4 h-1.5' : 'bg-white/30 w-1.5 h-1.5'}`} />)}</div>}
    </div>
  );
}

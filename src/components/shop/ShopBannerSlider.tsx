import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { listActiveShopPromoBanners, recordShopPromoBannerEvent, type ShopPromoBanner } from '@/services/shopPromotion.service';

function createVisitorKey() {
  try {
    const key = 'sykabelajar-shop-promo-visitor';
    const existing = window.sessionStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{16,80}$/.test(existing)) return existing;
    const next = 'visitor-' + (window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return 'visitor-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function ShopBannerSlider() {
  const [banners, setBanners] = useState<ShopPromoBanner[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visitorKey] = useState(createVisitorKey);
  const currentBanner = banners[activeIndex] ?? null;

  useEffect(() => {
    let active = true;
    void listActiveShopPromoBanners()
      .then((rows) => { if (active) { setBanners(rows); setActiveIndex(0); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!currentBanner) return;
    void recordShopPromoBannerEvent(currentBanner.id, 'VIEW', visitorKey).catch(() => undefined);
  }, [currentBanner?.id, visitorKey]);

  useEffect(() => {
    if (banners.length < 2 || !currentBanner) return;
    const duration = Math.max(2, Math.min(60, currentBanner.slide_duration_seconds || 5)) * 1000;
    const timer = window.setTimeout(() => setActiveIndex((index) => (index + 1) % banners.length), duration);
    return () => window.clearTimeout(timer);
  }, [banners, activeIndex, currentBanner]);

  const clickKey = useMemo(() => visitorKey.slice(0, 28), [visitorKey]);
  if (!currentBanner) return null;

  const trackClick = () => {
    const unique = clickKey + '-click-' + (window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    void recordShopPromoBannerEvent(currentBanner.id, 'CLICK', unique).catch(() => undefined);
  };

  const imageContent = <div className="relative aspect-[16/5] min-h-[112px] max-h-[250px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
    <img src={currentBanner.image_url} alt="Banner promosi Shop" loading="lazy" className="h-full w-full object-cover"/>
    {currentBanner.target_url && <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-slate-950/75 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur"><ExternalLink size={11}/>Lihat promo</span>}
  </div>;

  return <section aria-label="Promosi Shop" className="relative">
    <div className="relative">
      {currentBanner.target_url
        ? <a href={currentBanner.target_url} onClick={trackClick} target="_blank" rel="noopener noreferrer" className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{imageContent}</a>
        : imageContent}
      {banners.length > 1 && <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-slate-950/50 to-transparent pb-2 pt-5">
        {banners.map((banner, index) => <button key={banner.id} type="button" aria-label={'Tampilkan banner ' + (index + 1)} aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setActiveIndex(index)} className={'h-1.5 rounded-full transition-all ' + (index === activeIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80')}/>)}
      </div>}
    </div>
    {banners.length > 1 && <>
      <button type="button" aria-label="Banner sebelumnya" onClick={() => setActiveIndex((index) => (index - 1 + banners.length) % banners.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/65 p-1.5 text-white shadow-lg backdrop-blur hover:bg-slate-950/90"><ChevronLeft size={16}/></button>
      <button type="button" aria-label="Banner berikutnya" onClick={() => setActiveIndex((index) => (index + 1) % banners.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/65 p-1.5 text-white shadow-lg backdrop-blur hover:bg-slate-950/90"><ChevronRight size={16}/></button>
    </>}
  </section>;
}

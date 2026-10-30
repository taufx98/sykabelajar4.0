import { useCallback, useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { BannerCarousel } from '@/components/ui/BannerCarousel';
import type { PublicBanner } from '@/services/public-banner.service';

export function MobileHomeAdsPopup() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const [open, setOpen] = useState(true);
  const [hasBanners, setHasBanners] = useState(false);
  const [openCycle, setOpenCycle] = useState(0);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [closeInSeconds, setCloseInSeconds] = useState(5);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => {
      setIsMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handleHomeClick = () => {
      if (!window.matchMedia('(max-width: 1023px)').matches) return;
      setIsMobile(true);
      setHasBanners(false);
      setOpen(true);
      setOpenCycle((value) => value + 1);
      setOpenedAt(Date.now());
    };
    window.addEventListener('syka:home-click', handleHomeClick);
    return () => window.removeEventListener('syka:home-click', handleHomeClick);
  }, []);

  useEffect(() => {
    if (!isMobile || !open) return;
    const updateCountdown = () => setCloseInSeconds(Math.max(0, Math.ceil((openedAt + 5000 - Date.now()) / 1000)));
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 200);
    return () => window.clearInterval(timer);
  }, [isMobile, open, openedAt, openCycle]);

  useEffect(() => {
    if (!isMobile || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isMobile, open]);

  const handleBannersLoaded = useCallback((banners: PublicBanner[]) => {
    setHasBanners(banners.length > 0);
    if (banners.length === 0) setOpen(false);
  }, []);

  if (!isMobile || !open) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-home-ads-title"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border surface-border surface-card-bg p-4 shadow-2xl sm:p-5"
      >
        <header className="mb-3 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Megaphone size={18}/></span>
          <div className="min-w-0 flex-1">
            <h2 id="mobile-home-ads-title" className="text-sm font-bold text-fg">Iklan & rekomendasi</h2>
            <p className="mt-0.5 text-[11px] text-fg-muted">{hasBanners ? 'Geser atau gunakan tombol panah untuk melihat iklan lainnya.' : 'Memuat iklan…'}</p>
          </div>
          <button
            type="button"
            onClick={() => { if (closeInSeconds === 0) setOpen(false); }}
            disabled={closeInSeconds > 0}
            aria-label={closeInSeconds > 0 ? `Tutup tersedia dalam ${closeInSeconds} detik` : 'Tutup iklan'}
            title={closeInSeconds > 0 ? `Tunggu ${closeInSeconds} detik untuk menutup` : 'Tutup iklan'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border surface-border text-fg-muted transition hover:bg-surface-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18}/>
          </button>
        </header>
        <div className="overflow-hidden rounded-xl">
          <BannerCarousel key={openCycle} placement="home_sidebar" showArrows onBannersLoaded={handleBannersLoaded}/>
        </div>
        {closeInSeconds > 0 && <p className="mt-3 text-center text-[10px] text-fg-muted">Tombol tutup aktif dalam {closeInSeconds} detik.</p>}
      </section>
    </div>
  );
}

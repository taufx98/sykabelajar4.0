import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowUpDown, Heart, Loader2, Search, ShoppingBag, SlidersHorizontal, Sparkles, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatShortDate } from '@/lib/utils';
import {
  getShopHeroBanner,
  listMyWishlist,
  listProductReviewSummaries,
  listProductReviews,
  addWishlistItem,
  removeWishlistItem,
  saveProductReview,
  type ProductReview,
  type ProductReviewSummary,
  type ShopHeroBanner,
} from '@/services/shopEngagement.service';
import type { CommerceProduct } from '@/services/commerce.service';

type ShopTab = 'catalog' | 'history' | 'wishlist';
type ShopCategory = 'all' | 'coin' | 'competition' | 'certificate' | 'service';
type ProductReviewState = { rows: ProductReview[]; hasMore: boolean; page: number; loading: boolean };

type Props = {
  products: CommerceProduct[];
  orders: Array<Record<string, any>>;
  userId?: string;
  loading: boolean;
  historyContent: ReactNode;
  productBenefit: (product: CommerceProduct) => string;
  displayPrice: (product: CommerceProduct) => number;
  formatProductPrice: (price: number, currency: string) => string;
  getBuyState: (product: CommerceProduct) => { disabled: boolean; label: string };
  onBuy: (product: CommerceProduct) => void;
};

const CATEGORIES: Array<{ id: ShopCategory; label: string }> = [
  { id: 'all', label: 'Semua produk' },
  { id: 'coin', label: 'Edu Coin' },
  { id: 'competition', label: 'Item lomba' },
  { id: 'certificate', label: 'Sertifikat & QR' },
  { id: 'service', label: 'Layanan' },
];

function categoryForProduct(product: CommerceProduct): ShopCategory {
  if (product.product_type === 'EDU_COIN_TOPUP') return 'coin';
  if (['CERTIFICATE_SERIALS', 'COLLECTIVE_CERTIFICATE'].includes(product.product_type)) return 'certificate';
  if (['BADGE'].includes(product.product_type)) return 'competition';
  return 'service';
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    EDU_COIN_TOPUP: 'Paket Edu Coin',
    BADGE: 'Badge profil',
    CERTIFICATE_SERIALS: 'QR / Serial Sertifikat',
    COLLECTIVE_CERTIFICATE: 'Sertifikat peserta',
    DIGITAL_ITEM: 'Layanan / materi lomba',
    DONATION: 'Donasi',
  };
  return labels[type] ?? 'Produk SYKABELAJAR';
}

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return <span className="inline-flex items-center gap-0.5" aria-label={`Rating ${value.toFixed(1)} dari 5`}>
    {Array.from({ length: 5 }, (_, index) => (
      <Star key={index} size={size} className={index < Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
    ))}
  </span>;
}

function hasVerifiedPurchase(orders: Array<Record<string, any>>, productId: string) {
  return orders.some((order) => {
    if (!['PAID', 'COMPLETED'].includes(String(order.status ?? '').toUpperCase())) return false;
    const items = Array.isArray(order.order_items) ? order.order_items : order.order_items ? [order.order_items] : [];
    return items.some((item: Record<string, unknown>) => String(item.product_ref ?? '') === productId);
  });
}

export function ShopExperience({
  products,
  orders,
  userId,
  loading,
  historyContent,
  productBenefit,
  displayPrice,
  formatProductPrice,
  getBuyState,
  onBuy,
}: Props) {
  const [tab, setTab] = useState<ShopTab>('catalog');
  const [category, setCategory] = useState<ShopCategory>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'featured' | 'price-low' | 'price-high' | 'name'>('featured');
  const [banner, setBanner] = useState<ShopHeroBanner>({
    enabled: true,
    badge: 'SYKABELAJAR SHOP',
    title: 'Kebutuhan belajar dan lomba dalam satu tempat',
    subtitle: 'Temukan produk digital dan layanan resmi yang tersedia di SYKABELAJAR.',
    image_url: '',
  });
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishlistBusyId, setWishlistBusyId] = useState('');
  const [reviewSummaries, setReviewSummaries] = useState<Map<string, ProductReviewSummary>>(new Map());
  const [selectedProduct, setSelectedProduct] = useState<CommerceProduct | null>(null);
  const [reviewState, setReviewState] = useState<ProductReviewState>({ rows: [], hasMore: false, page: 0, loading: false });
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([
      getShopHeroBanner().then((value) => { if (active) setBanner(value); }).catch(() => undefined),
      listProductReviewSummaries().then((rows) => {
        if (active) setReviewSummaries(new Map(rows.map((row) => [row.product_id, row])));
      }).catch(() => undefined),
      userId ? listMyWishlist().then((ids) => {
        if (active) setWishlistIds(new Set(ids));
      }).catch(() => undefined) : Promise.resolve(),
    ]);
    return () => { active = false; };
  }, [userId]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('id-ID');
    const filtered = products.filter((product) => {
      const matchesCategory = category === 'all' || categoryForProduct(product) === category;
      const matchesSearch = !query || [product.name, product.short_description, product.description, typeLabel(product.product_type)]
        .some((value) => String(value ?? '').toLocaleLowerCase('id-ID').includes(query));
      return matchesCategory && matchesSearch;
    });
    return filtered.sort((left, right) => {
      if (sort === 'price-low') return displayPrice(left) - displayPrice(right);
      if (sort === 'price-high') return displayPrice(right) - displayPrice(left);
      if (sort === 'name') return left.name.localeCompare(right.name, 'id');
      return Number(right.is_featured) - Number(left.is_featured) || left.sort_order - right.sort_order;
    });
  }, [products, category, search, sort, displayPrice]);

  const wishlistProducts = useMemo(
    () => products.filter((product) => wishlistIds.has(product.id)),
    [products, wishlistIds],
  );

  const refreshReviewSummary = async () => {
    const rows = await listProductReviewSummaries();
    setReviewSummaries(new Map(rows.map((row) => [row.product_id, row])));
  };

  const toggleWishlist = async (product: CommerceProduct) => {
    if (!userId || wishlistBusyId) return;
    setWishlistBusyId(product.id);
    setNotice('');
    try {
      if (wishlistIds.has(product.id)) {
        await removeWishlistItem(product.id);
        setWishlistIds((current) => {
          const next = new Set(current);
          next.delete(product.id);
          return next;
        });
      } else {
        await addWishlistItem(product.id);
        setWishlistIds((current) => new Set(current).add(product.id));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Whitelist belum berhasil diperbarui.');
    } finally {
      setWishlistBusyId('');
    }
  };

  const loadReviews = async (productId: string, page = 0, append = false) => {
    setReviewState((current) => ({ ...current, loading: true }));
    try {
      const result = await listProductReviews(productId, page);
      setReviewState((current) => ({
        rows: append ? [...current.rows, ...result.rows] : result.rows,
        hasMore: result.hasMore,
        page,
        loading: false,
      }));
    } catch {
      setReviewState((current) => ({ ...current, loading: false }));
      setNotice('Ulasan produk belum dapat dimuat. Coba lagi.');
    }
  };

  const openDetails = (product: CommerceProduct) => {
    setSelectedProduct(product);
    setRating(5);
    setReviewText('');
    setNotice('');
    setReviewState({ rows: [], hasMore: false, page: 0, loading: true });
    void loadReviews(product.id);
  };

  const canReview = Boolean(selectedProduct && userId && hasVerifiedPurchase(orders, selectedProduct.id));

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !userId || !canReview || reviewBusy) return;
    setReviewBusy(true);
    setNotice('');
    try {
      await saveProductReview(selectedProduct.id, rating, reviewText);
      await Promise.all([loadReviews(selectedProduct.id), refreshReviewSummary()]);
      setNotice('Rating dan ulasan berhasil disimpan.');
    } catch (error) {
      const message = String((error as { message?: string } | null)?.message ?? '');
      setNotice(message.includes('permission') || message.includes('row-level security')
        ? 'Ulasan hanya dapat dikirim setelah pesanan dibayar dan diverifikasi.'
        : message || 'Rating belum berhasil disimpan.');
    } finally {
      setReviewBusy(false);
    }
  };

  const ProductCard = ({ product, fromWishlist = false }: { product: CommerceProduct; fromWishlist?: boolean }) => {
    const summary = reviewSummaries.get(product.id);
    const buyState = getBuyState(product);
    const price = displayPrice(product);
    return <Card className="group overflow-hidden border border-slate-800 bg-[#111B2C] p-0 transition hover:border-blue-500/40">
      <div className="relative aspect-[4/3] overflow-hidden bg-[#0D1728]">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
          : <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#15243A] to-[#0D1728]"><ShoppingBag size={32} className="text-slate-600"/></div>}
        {product.is_featured && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-sky-400/25 bg-[#0B1120]/90 px-2.5 py-1 text-[10px] font-bold text-sky-300"><Sparkles size={11}/> Pilihan</span>}
        <button type="button" onClick={() => void toggleWishlist(product)} disabled={!userId || wishlistBusyId === product.id} aria-label={wishlistIds.has(product.id) ? 'Hapus dari whitelist' : 'Simpan ke whitelist'} className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition ${wishlistIds.has(product.id) ? 'border-rose-400/40 bg-rose-500/20 text-rose-300' : 'border-white/15 bg-[#0B1120]/80 text-slate-200 hover:border-rose-400/50 hover:text-rose-300'}`}>
          {wishlistBusyId === product.id ? <Loader2 size={16} className="animate-spin"/> : <Heart size={16} className={wishlistIds.has(product.id) ? 'fill-current' : ''}/>}
        </button>
      </div>
      <div className="space-y-3 p-3.5 sm:p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-sky-300">{typeLabel(product.product_type)}</p>
          <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-bold leading-5 text-slate-100">{product.name}</h3>
          <p className="mt-1 line-clamp-2 min-h-9 text-xs leading-4 text-slate-400">{product.short_description || productBenefit(product)}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          {summary && summary.review_count > 0
            ? <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300"><Stars value={summary.average_rating}/><span>{summary.average_rating.toFixed(1)} ({summary.review_count})</span></span>
            : <span className="text-[11px] text-slate-500">Belum ada rating</span>}
          <span className="text-[10px] text-slate-500">{fromWishlist ? 'Tersimpan di WL' : ''}</span>
        </div>
        <p className="text-base font-extrabold text-sky-300">{price <= 0 && product.product_type === 'COLLECTIVE_CERTIFICATE' ? 'Harga belum diatur' : formatProductPrice(price, product.currency)}</p>
        <div className="grid grid-cols-[0.85fr_1.15fr] gap-2">
          <Button size="sm" variant="outline" className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800" onClick={() => openDetails(product)}>Detail</Button>
          <Button size="sm" disabled={buyState.disabled} onClick={() => onBuy(product)}>{buyState.label}</Button>
        </div>
      </div>
    </Card>;
  };

  return <div className="space-y-5">
    {tab === 'catalog' && banner.enabled && <section className="relative isolate overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-[#132D52] via-[#12243D] to-[#111A2B] p-5 shadow-xl sm:p-7">
      <div className="absolute inset-0 -z-10 opacity-25" style={{ background: 'radial-gradient(circle at 76% 20%, #2563EB 0, transparent 42%)' }} />
      {banner.image_url && <img src={banner.image_url} alt="" aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 h-full w-2/5 object-cover opacity-35 [mask-image:linear-gradient(to_right,transparent,black)]"/>}
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1 text-[10px] font-bold tracking-[0.15em] text-sky-200">{banner.badge}</span>
        <h2 className="mt-4 max-w-xl font-display text-2xl font-extrabold leading-tight text-white sm:text-3xl">{banner.title}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{banner.subtitle}</p>
      </div>
    </section>}

    <div className="space-y-3 rounded-2xl border border-slate-800 bg-[#101A2A] p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input className="w-full rounded-xl border border-slate-700 bg-[#0B1422] py-2.5 pl-10 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari produk, layanan, atau kategori..." aria-label="Cari produk Shop"/>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-[#0B1422] p-1">
          {([
            ['catalog', 'Katalog Shop'],
            ['history', 'Status & History'],
            ['wishlist', 'Whitelist'],
          ] as Array<[ShopTab, string]>).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-lg px-2 py-2 text-[10px] font-semibold transition sm:px-3 sm:text-xs ${tab === id ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'catalog' && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((item) => <button key={item.id} type="button" onClick={() => setCategory(item.id)} className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${category === item.id ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>{item.label}</button>)}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-slate-400"><SlidersHorizontal size={14}/><span>Urutkan</span><select className="rounded-lg border border-slate-700 bg-[#0B1422] px-2.5 py-2 text-xs text-slate-200 outline-none" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Urutkan produk"><option value="featured">Pilihan</option><option value="price-low">Harga terendah</option><option value="price-high">Harga tertinggi</option><option value="name">Nama A–Z</option></select></label>
      </div>}
    </div>

    {notice && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{notice}</div>}

    {tab === 'catalog' && <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><p className="text-[10px] font-bold tracking-[0.18em] text-sky-300">SHOP SYKABELAJAR</p><h2 className="mt-1 font-display text-xl font-bold text-slate-100 sm:text-2xl">Temukan yang kamu butuhkan</h2></div>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400"/>}
      </div>
      {visibleProducts.length ? <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {visibleProducts.map((product) => <ProductCard key={product.id} product={product}/>)}
      </div> : <Card className="border-slate-800 bg-[#111B2C] p-8 text-center text-sm text-slate-400">
        {loading ? 'Memuat katalog Shop…' : products.length ? 'Tidak ada produk yang cocok dengan pencarian atau kategori ini.' : 'Belum ada produk Shop yang diaktifkan.'}
      </Card>}
    </section>}

    {tab === 'history' && <section>{historyContent}</section>}

    {tab === 'wishlist' && <section>
      {wishlistProducts.length ? <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {wishlistProducts.map((product) => <ProductCard key={product.id} product={product} fromWishlist/>)}
      </div> : <Card className="border-slate-800 bg-[#111B2C] p-8 text-center text-sm text-slate-400">
        Produk yang kamu simpan akan tampil di sini.
      </Card>}
    </section>}

    {selectedProduct && <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/75 p-3 sm:p-5" onClick={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
      <Card className="max-h-[94dvh] w-full max-w-3xl overflow-auto border border-slate-700 bg-[#111B2C] p-0 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-300">{typeLabel(selectedProduct.product_type)}</p><h2 className="mt-1 font-display text-xl font-bold">{selectedProduct.name}</h2><p className="mt-1 text-sm text-slate-400">{formatProductPrice(displayPrice(selectedProduct), selectedProduct.currency)}</p></div>
          <button type="button" onClick={() => setSelectedProduct(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Tutup detail produk"><X size={18}/></button>
        </div>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0B1422]">
              {selectedProduct.image_url ? <img src={selectedProduct.image_url} alt={selectedProduct.name} className="aspect-[4/3] w-full object-cover"/> : <div className="flex aspect-[4/3] items-center justify-center"><ShoppingBag size={38} className="text-slate-600"/></div>}
            </div>
            <p className="whitespace-pre-line text-sm leading-6 text-slate-300">{selectedProduct.description || selectedProduct.short_description || productBenefit(selectedProduct)}</p>
            <div className="rounded-xl border border-slate-800 bg-[#0B1422] p-3">
              <p className="text-xs font-semibold text-slate-100">Pembelian melalui Shop</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">Gunakan tombol pesan untuk melanjutkan ke alur pembayaran resmi yang sudah dikonfigurasi admin.</p>
              <Button className="mt-3 w-full" disabled={getBuyState(selectedProduct).disabled} onClick={() => { const product = selectedProduct; setSelectedProduct(null); onBuy(product); }}>{getBuyState(selectedProduct).label}</Button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold">Rating & ulasan</h3><p className="mt-1 text-xs text-slate-400">Dari pembeli yang sudah menyelesaikan pembayaran.</p></div>
              {reviewSummaries.get(selectedProduct.id)?.review_count ? <div className="text-right"><p className="text-lg font-bold">{reviewSummaries.get(selectedProduct.id)?.average_rating.toFixed(1)}</p><p className="text-[10px] text-slate-500">{reviewSummaries.get(selectedProduct.id)?.review_count} ulasan</p></div> : null}
            </div>
            {reviewState.loading && reviewState.rows.length === 0 ? <div className="flex items-center gap-2 py-5 text-xs text-slate-400"><Loader2 size={14} className="animate-spin"/>Memuat ulasan…</div>
              : reviewState.rows.length ? <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {reviewState.rows.map((review) => <div key={review.id} className="rounded-xl border border-slate-800 bg-[#0B1422] p-3">
                  <div className="flex items-center justify-between gap-2"><Stars value={review.rating}/><span className="text-[10px] text-slate-500">{formatShortDate(review.created_at)}</span></div>
                  {review.review && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-300">{review.review}</p>}
                  <p className="mt-2 text-[10px] text-emerald-300">Pembelian terverifikasi</p>
                </div>)}
                {reviewState.hasMore && <Button size="sm" variant="outline" className="w-full border-slate-700 text-slate-200" disabled={reviewState.loading} onClick={() => void loadReviews(selectedProduct.id, reviewState.page + 1, true)}>Muat ulasan berikutnya</Button>}
              </div> : <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-xs text-slate-500">Belum ada ulasan untuk produk ini.</div>}

            {canReview ? <form onSubmit={(event) => void submitReview(event)} className="space-y-3 rounded-xl border border-slate-700 bg-[#0B1422] p-3">
              <div><h4 className="text-xs font-bold">Ulasan pembelianmu</h4><p className="mt-1 text-[10px] text-slate-500">Rating hanya tersedia untuk pesanan yang sudah dibayar.</p></div>
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Pilih rating produk">
                {Array.from({ length: 5 }, (_, index) => {
                  const value = index + 1;
                  return <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} bintang`} aria-pressed={rating === value} className="rounded-md p-1 transition hover:bg-slate-800"><Star size={22} className={value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}/></button>;
                })}
              </div>
              <textarea className="min-h-20 w-full rounded-xl border border-slate-700 bg-[#101A2A] p-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" maxLength={1200} value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="Ceritakan pengalamanmu menggunakan produk ini (opsional)."/>
              <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{reviewText.length}/1200</span><Button size="sm" type="submit" loading={reviewBusy} disabled={reviewBusy}>Kirim rating</Button></div>
            </form> : <div className="rounded-xl border border-slate-800 bg-[#0B1422] p-3 text-xs leading-5 text-slate-500">Ulasan hanya dapat dikirim setelah pesanan dibayar dan diverifikasi untuk akun ini.</div>}
          </div>
        </div>
      </Card>
    </div>}
  </div>;
}

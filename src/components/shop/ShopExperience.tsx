import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, Heart, Info, Loader2, MessageSquare, Receipt, Search, ShoppingCart, ShoppingBag, Sparkles, Star, Store, Tag, X } from 'lucide-react';
import { formatShortDate } from '@/lib/utils';
import {
  DEFAULT_SHOP_HERO_BANNER,
  DEFAULT_SHOP_PRODUCT_CATEGORIES,
  getShopHeroBanner,
  getShopProductCategories,
  listMyWishlist,
  listProductReviewSummaries,
  listProductSalesCounts,
  listProductReviews,
  addWishlistItem,
  removeWishlistItem,
  saveProductReview,
  hasVerifiedProductPurchase,
  type ProductReview,
  type ProductReviewSummary,
  type ProductSalesSummary,
  type ShopHeroBanner,
  type ShopProductCategory,
} from '@/services/shopEngagement.service';
import type { CommerceProduct } from '@/services/commerce.service';
import { ShopBannerSlider } from '@/components/shop/ShopBannerSlider';
import { listMyShopVouchers, markMyShopVouchersSeen, type ShopUserVoucher } from '@/services/shopPromotion.service';

type ShopTab = 'catalog' | 'history' | 'wishlist' | 'vouchers';
type ShopSort = 'default' | 'price-asc' | 'price-desc' | 'rating-desc' | 'rating-asc' | 'popular';
type ProductReviewState = { rows: ProductReview[]; hasMore: boolean; page: number; loading: boolean };

type Props = {
  products: CommerceProduct[];
  userId?: string;
  loading: boolean;
  ordersCount: number;
  historyContent: ReactNode;
  productBenefit: (product: CommerceProduct) => string;
  displayPrice: (product: CommerceProduct) => number;
  formatProductPrice: (price: number, currency: string) => string;
  getBuyState: (product: CommerceProduct) => { disabled: boolean; label: string };
  onBuy: (product: CommerceProduct, summary?: ProductReviewSummary, salesCount?: number) => void;
};

const DEFAULT_BANNER_IMAGE = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80';

function voucherTitle(voucher: ShopUserVoucher) {
  if (voucher.benefit_type === 'PERCENT') return voucher.discount_value + '% OFF';
  if (voucher.benefit_type === 'FIXED') return (voucher.discount_currency === 'EDU_COIN' ? 'Coin ' : 'Rp ') + voucher.discount_value.toLocaleString('id-ID');
  if (voucher.benefit_type === 'BUY_X_GET_Y') return 'Beli X Gratis Y';
  return 'Gratis Ongkir';
}

function formatVoucherCountdown(activeUntil: string | null, now: number) {
  if (!activeUntil) return '';
  const remaining = new Date(activeUntil).getTime() - now;
  if (remaining <= 0) return 'Kedaluwarsa';
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return hours > 0 ? hours + 'j ' + minutes + 'm tersisa' : minutes + 'm tersisa';
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    EDU_COIN_TOPUP: 'Paket Edu Coin',
    BADGE: 'Badge Profil',
    CERTIFICATE_SERIALS: 'QR / Serial Sertifikat',
    COLLECTIVE_CERTIFICATE: 'Sertifikat Peserta',
    DIGITAL_ITEM: 'Item Lomba',
    DONATION: 'Dukungan SYKABELAJAR',
    VOUCHER: 'Voucher Diskon',
  };
  return labels[type] ?? 'Produk SYKABELAJAR';
}

function productBadge(product: CommerceProduct) {
  const configured = product.metadata?.shop_badge ?? product.metadata?.badge_label;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return product.is_featured ? 'Pilihan' : typeLabel(product.product_type);
}

function legacyCategoryIdForProduct(product: CommerceProduct) {
  const metadataCategory = String(product.metadata?.shop_category ?? product.metadata?.category ?? '').trim().toLocaleLowerCase('id-ID');
  if (product.product_type === 'VOUCHER' || metadataCategory.includes('voucher')) return 'voucher-diskon';
  if (product.product_type === 'EDU_COIN_TOPUP' || metadataCategory === 'coin' || metadataCategory === 'edu coin') return 'edu-coin';
  if (['CERTIFICATE_SERIALS', 'COLLECTIVE_CERTIFICATE'].includes(product.product_type)) return 'sertifikat-barcode';
  return 'item-lomba-bypass';
}

function categoryForProduct(product: CommerceProduct, categories: ShopProductCategory[]) {
  const selectedCategoryId = String(product.metadata?.shop_category_id ?? '').trim().toLowerCase();
  if (selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)) return selectedCategoryId;

  const metadataCategory = String(product.metadata?.shop_category ?? product.metadata?.category ?? '').trim().toLocaleLowerCase('id-ID');
  const matchingCategory = categories.find((category) => category.id === metadataCategory
    || category.label.trim().toLocaleLowerCase('id-ID') === metadataCategory);
  if (matchingCategory) return matchingCategory.id;

  const legacyId = legacyCategoryIdForProduct(product);
  return categories.some((category) => category.id === legacyId) ? legacyId : '';
}

function getWishlistErrorNotice(error: unknown) {
  let code = '';
  let message = '';

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    code = String(record.code ?? '');
    message = String(record.message ?? '');
  }

  if (code === 'PGRST205' || message.includes('PGRST205') || message.includes('commerce_product_wishlist')) {
    return 'Whitelist belum tersedia di database Shop. Migrasi Shop belum diterapkan atau schema API belum dimuat ulang.';
  }

  return message || 'Whitelist belum berhasil diperbarui.';
}

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return <span className="inline-flex items-center gap-0.5" aria-label={'Rating ' + value.toFixed(1) + ' dari 5'}>
    {Array.from({ length: 5 }, (_, index) => (
      <Star key={index} size={size} className={index < Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-700'} />
    ))}
  </span>;
}

export function ShopExperience({
  products,
  userId,
  loading,
  ordersCount,
  historyContent,
  productBenefit,
  displayPrice,
  formatProductPrice,
  getBuyState,
  onBuy,
}: Props) {
  const [tab, setTab] = useState<ShopTab>('catalog');
  const [category, setCategory] = useState('all');
  const [categoryOptions, setCategoryOptions] = useState<ShopProductCategory[]>(DEFAULT_SHOP_PRODUCT_CATEGORIES);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ShopSort>('default');
  const [banner, setBanner] = useState<ShopHeroBanner>(DEFAULT_SHOP_HERO_BANNER);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [myVouchers, setMyVouchers] = useState<ShopUserVoucher[]>([]);
  const [voucherNow, setVoucherNow] = useState(Date.now());
  const [wishlistBusyId, setWishlistBusyId] = useState('');
  const [reviewSummaries, setReviewSummaries] = useState<Map<string, ProductReviewSummary>>(new Map());
  const [salesCounts, setSalesCounts] = useState<Map<string, number>>(new Map());
  const [selectedProduct, setSelectedProduct] = useState<CommerceProduct | null>(null);
  const [reviewState, setReviewState] = useState<ProductReviewState>({ rows: [], hasMore: false, page: 0, loading: false });
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [verifiedPurchase, setVerifiedPurchase] = useState(false);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([
      getShopHeroBanner().then((value) => { if (active) setBanner(value); }).catch(() => undefined),
      getShopProductCategories().then((rows) => { if (active) setCategoryOptions(rows.filter((row) => row.is_active)); }).catch(() => undefined),
      listProductReviewSummaries().then((rows) => {
        if (active) setReviewSummaries(new Map(rows.map((row) => [row.product_id, row])));
      }).catch(() => undefined),
      listProductSalesCounts().then((rows: ProductSalesSummary[]) => {
        if (active) setSalesCounts(new Map(rows.map((row) => [row.product_id, row.sales_count])));
      }).catch(() => undefined),
      userId ? listMyWishlist().then((ids) => {
        if (active) setWishlistIds(new Set(ids));
      }).catch(() => undefined) : Promise.resolve(),
    ]);
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setMyVouchers([]);
      return () => { active = false; };
    }
    void listMyShopVouchers()
      .then((rows) => { if (active) setMyVouchers(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (tab !== 'vouchers' || !userId) return;
    void markMyShopVouchersSeen()
      .then(() => setMyVouchers((current) => current.map((voucher) => ({ ...voucher, is_new: false, viewed_at: voucher.viewed_at ?? new Date().toISOString() }))))
      .catch(() => undefined);
  }, [tab, userId]);

  useEffect(() => {
    if (!myVouchers.some((voucher) => voucher.status === 'ACTIVE' && voucher.usage_type === 'DURATION')) return;
    const timer = window.setInterval(() => setVoucherNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [myVouchers]);

  const newVoucherCount = myVouchers.filter((voucher) => voucher.is_new).length;

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('id-ID');
    const filtered = products.filter((product) => {
      const matchesCategory = category === 'all' || categoryForProduct(product, categoryOptions) === category;
      const matchesSearch = !query || [
        product.name,
        product.short_description,
        product.description,
        typeLabel(product.product_type),
      ].some((value) => String(value ?? '').toLocaleLowerCase('id-ID').includes(query));
      return matchesCategory && matchesSearch;
    });

    return filtered.sort((left, right) => {
      const leftSummary = reviewSummaries.get(left.id);
      const rightSummary = reviewSummaries.get(right.id);
      if (sort === 'price-asc') return displayPrice(right) - displayPrice(left);
      if (sort === 'price-desc') return displayPrice(left) - displayPrice(right);
      if (sort === 'rating-desc') return (rightSummary?.average_rating ?? 0) - (leftSummary?.average_rating ?? 0);
      if (sort === 'rating-asc') return (leftSummary?.average_rating ?? 0) - (rightSummary?.average_rating ?? 0);
      if (sort === 'popular') {
        return (rightSummary?.review_count ?? 0) - (leftSummary?.review_count ?? 0)
          || (salesCounts.get(right.id) ?? 0) - (salesCounts.get(left.id) ?? 0);
      }
      return Number(right.is_featured) - Number(left.is_featured) || left.sort_order - right.sort_order;
    });
  }, [products, category, categoryOptions, search, sort, displayPrice, reviewSummaries, salesCounts]);

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
      setNotice(getWishlistErrorNotice(error));
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
    setVerifiedPurchase(false);
    setRating(5);
    setReviewText('');
    setRatingModalOpen(false);
    setNotice('');
    setReviewState({ rows: [], hasMore: false, page: 0, loading: true });
    void loadReviews(product.id);
    void hasVerifiedProductPurchase(product.id).then(setVerifiedPurchase).catch(() => setVerifiedPurchase(false));
  };

  const closeDetails = () => {
    setRatingModalOpen(false);
    setSelectedProduct(null);
    setReviewText('');
  };

  const canReview = Boolean(selectedProduct && userId && verifiedPurchase);

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !userId || !canReview || reviewBusy) return;
    setReviewBusy(true);
    setNotice('');
    try {
      await saveProductReview(selectedProduct.id, rating, reviewText);
      await Promise.all([loadReviews(selectedProduct.id), refreshReviewSummary()]);
      setRatingModalOpen(false);
      setNotice('Rating dan ulasan berhasil disimpan.');
    } catch (error) {
      const message = String((error as { message?: string } | null)?.message ?? '');
      setNotice(message.includes('permission') || message.includes('row-level security') || message.includes('VERIFIED_PURCHASE_REQUIRED')
        ? 'Ulasan hanya dapat dikirim setelah pesanan dibayar dan diverifikasi.'
        : message || 'Rating belum berhasil disimpan.');
    } finally {
      setReviewBusy(false);
    }
  };

  const ProductCard = ({ product }: { product: CommerceProduct }) => {
    const summary = reviewSummaries.get(product.id);
    const salesCount = salesCounts.get(product.id) ?? 0;
    const buyState = getBuyState(product);
    const price = displayPrice(product);

    return <div className="bg-[#151F32] border border-slate-800/90 hover:border-blue-500/40 rounded-2xl overflow-hidden flex flex-col group transition-all duration-300 hover:shadow-xl hover:shadow-blue-950/30">
      <div className="relative h-40 overflow-hidden bg-slate-900">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#15243A] to-[#0D1728]"><ShoppingBag size={32} className="text-slate-600" /></div>}
        <span className="absolute top-2.5 left-2.5 bg-slate-950/80 backdrop-blur border border-slate-700/80 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-blue-400">
          {productBadge(product)}
        </span>
        <button
          type="button"
          onClick={() => void toggleWishlist(product)}
          disabled={!userId || wishlistBusyId === product.id}
          aria-label={wishlistIds.has(product.id) ? 'Hapus dari whitelist' : 'Simpan ke whitelist'}
          className={'absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-slate-900/80 backdrop-blur flex items-center justify-center transition border border-slate-700 ' + (wishlistIds.has(product.id) ? 'text-rose-500' : 'text-slate-400 hover:text-rose-400')}
        >
          {wishlistBusyId === product.id
            ? <Loader2 size={14} className="animate-spin" />
            : <Heart size={16} className={wishlistIds.has(product.id) ? 'fill-rose-500 text-rose-500' : ''} />}
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-[11px] text-amber-400 font-bold">
            <Star size={14} className="fill-amber-400" />
            {summary && summary.review_count > 0
              ? <span>{summary.average_rating.toFixed(1)}</span>
              : <span className="text-slate-500 font-normal">Belum ada rating</span>}
            <span className="text-slate-600">•</span>
            <span className="text-slate-500 font-normal">({salesCount.toLocaleString('id-ID')} terjual)</span>
          </div>
          <h3 className="font-bold text-white text-xs md:text-sm line-clamp-1 group-hover:text-blue-400 transition-colors">{product.name}</h3>
          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{product.short_description || productBenefit(product)}</p>
        </div>

        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <div className="text-xl font-extrabold text-blue-400">
            {displayPrice(product) <= 0 && product.product_type === 'COLLECTIVE_CERTIFICATE'
              ? 'Harga belum diatur'
              : formatProductPrice(price, product.currency)}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => openDetails(product)} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center transition-all">
              Detail
            </button>
            <button
              type="button"
              disabled={buyState.disabled}
              onClick={() => onBuy(product, summary, salesCount)}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart size={14} />
              Beli
            </button>
          </div>
        </div>
      </div>
    </div>;
  };

  const detailSummary = selectedProduct ? reviewSummaries.get(selectedProduct.id) : undefined;
  const selectedProductSalesCount = selectedProduct ? salesCounts.get(selectedProduct.id) ?? 0 : 0;
  const detailWishlistSaved = selectedProduct ? wishlistIds.has(selectedProduct.id) : false;

  return <div className="space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
    {banner.enabled && <section className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-[#0F172A] via-[#1E1B4B] to-[#0F172A] border border-blue-500/20 p-6 md:p-8 shadow-2xl shadow-blue-950/40 group">
      <div className="absolute -right-10 -top-10 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute right-1/4 -bottom-10 w-48 h-48 bg-indigo-500/15 rounded-full blur-2xl pointer-events-none" />
      <div
        className="absolute right-0 top-0 bottom-0 w-1/2 md:w-5/12 bg-cover bg-center mix-blend-luminosity opacity-40 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none"
        style={{
          backgroundImage: 'url(' + (banner.image_url || DEFAULT_BANNER_IMAGE) + ')',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 40%, black 75%, transparent 100%)',
          maskImage: 'linear-gradient(to right, transparent 0%, black 40%, black 75%, transparent 100%)',
        }}
      />
      <div className="relative z-10 max-w-full md:max-w-[55%] lg:max-w-[60%] space-y-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-semibold">
          <Sparkles size={14} className="text-amber-400" />
          {banner.badge}
        </span>
        <h2 className="text-xl sm:text-2xl md:text-2xl lg:text-3xl font-extrabold text-white leading-tight whitespace-pre-line">{banner.title}</h2>
        <p className="text-slate-300 text-xs md:text-sm leading-relaxed pt-1">{banner.subtitle}</p>
      </div>
    </section>}

    <ShopBannerSlider />

    <section className="sticky top-[10px] z-10 bg-[#151F32]/95 backdrop-blur-md p-4 rounded-2xl border border-slate-800 flex flex-col lg:flex-row items-center justify-between gap-4 shadow-xl shadow-slate-950/50">
      <div className="relative w-full lg:w-80">
        <Search size={16} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari item, coin, atau barcode sertifikat..."
          className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition"
          aria-label="Cari item, coin, atau barcode sertifikat"
        />
      </div>
      <div className="flex items-center gap-2 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
        <button
          type="button"
          onClick={() => setTab('catalog')}
          className={'flex-1 lg:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition shadow-lg whitespace-nowrap ' + (tab === 'catalog' ? 'bg-blue-600 text-white shadow-blue-600/20' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700')}
        >
          <Store size={16} />
          Katalog Shop
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={'flex-1 lg:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition relative whitespace-nowrap ' + (tab === 'history' ? 'bg-blue-600 text-white shadow-blue-600/20' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700')}
        >
          <Receipt size={16} />
          Status & History
          <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{ordersCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('wishlist')}
          className={'flex-1 lg:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition relative whitespace-nowrap ' + (tab === 'wishlist' ? 'bg-blue-600 text-white shadow-blue-600/20' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700')}
        >
          <Heart size={16} className="text-rose-400" />
          Whitelist
          <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{wishlistIds.size}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('vouchers')}
          disabled={!userId}
          aria-label="Voucher saya"
          title="Voucher saya"
          className={'relative flex h-9 w-9 flex-none items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40 ' + (tab === 'vouchers' ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800')}
        >
          <img src="https://www.svgrepo.com/show/456865/discount-tag.svg" alt="" className="h-[18px] w-[18px] invert opacity-90"/>
          {newVoucherCount > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[17px] rounded-full bg-rose-500 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white">{newVoucherCount > 99 ? '99+' : newVoucherCount}</span>}
        </button>
      </div>
    </section>

    {tab === 'catalog' && <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
      <div className="relative inline-block text-left shrink-0 group">
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as ShopSort)}
          aria-label="Urutkan produk"
          className="appearance-none bg-slate-900/80 backdrop-blur text-slate-300 hover:text-blue-400 border border-slate-800 hover:border-blue-500/40 rounded-full pl-4 pr-9 py-2 text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-lg shadow-black/20 cursor-pointer transition-all duration-300"
        >
          <option value="default" className="bg-slate-950 text-slate-400">Filter</option>
          <option value="price-asc" className="bg-slate-950 text-slate-300">Harga Termahal</option>
          <option value="price-desc" className="bg-slate-950 text-slate-300">Harga Termurah</option>
          <option value="rating-desc" className="bg-slate-950 text-slate-300">Rating Tertinggi</option>
          <option value="rating-asc" className="bg-slate-950 text-slate-300">Rating Terendah</option>
          <option value="popular" className="bg-slate-950 text-slate-300">Paling Populer</option>
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-500 group-hover:text-blue-400 transition-colors duration-300">
          <ChevronDown size={14} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setCategory('all')}
        className={'cat-pill px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border ' + (category === 'all'
          ? 'active bg-blue-600/20 text-blue-400 border-blue-500/30'
          : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700')}
      >
        Semua Produk
      </button>
      {categoryOptions.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setCategory(item.id)}
          className={'cat-pill px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border ' + (category === item.id
            ? 'active bg-blue-600/20 text-blue-400 border-blue-500/30'
            : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700')}
        >
          {item.label}
        </button>
      ))}
    </div>}

    {notice && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{notice}</div>}

    {tab === 'catalog' && <section className="space-y-4 animate-section-in">
      {visibleProducts.length ? <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
        {visibleProducts.map((product) => <ProductCard key={product.id} product={product} />)}
      </div> : <div className="col-span-full text-center py-12 text-slate-500 text-xs">
        {loading ? 'Memuat katalog Shop…' : products.length ? 'Tidak ada produk yang cocok dengan pencarian Anda.' : 'Belum ada produk Shop yang diaktifkan.'}
      </div>}
    </section>}

    {tab === 'history' && <section className="space-y-4">{historyContent}</section>}

    {tab === 'wishlist' && <section className="space-y-4 animate-section-in">
      <div className="bg-[#151F32] p-4 rounded-xl border border-slate-800">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Heart size={16} className="text-rose-500 fill-rose-500" />
          Favorit & Whitelist Saya
        </h3>
        <p className="text-xs text-slate-400">Daftar item penunjang lomba yang telah Anda simpan untuk dibeli nanti.</p>
      </div>
      {wishlistProducts.length ? <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
        {wishlistProducts.map((product) => <ProductCard key={product.id} product={product} />)}
      </div> : <div className="text-center py-12 text-slate-500 text-xs">
        Produk yang kamu simpan akan tampil di sini.
      </div>}
    </section>}

    {tab === 'vouchers' && <section className="space-y-4 animate-section-in">
      <div className="rounded-xl border border-slate-800 bg-[#151F32] p-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-white"><Tag size={16} className="text-amber-400"/>Voucher Saya</h3>
        <p className="text-xs text-slate-400">Voucher hadiah dan promo yang tersimpan di akunmu.</p>
      </div>
      {myVouchers.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {myVouchers.map((voucher) => {
          const expired = voucher.status === 'EXPIRED' || (voucher.ends_at && new Date(voucher.ends_at).getTime() <= voucherNow);
          const activeDuration = voucher.usage_type === 'DURATION' && voucher.status === 'ACTIVE' && !expired;
          const status = expired ? 'Kedaluwarsa' : voucher.status === 'USED' ? 'Sudah digunakan' : voucher.status === 'RESERVED' ? 'Menunggu pembayaran' : activeDuration ? 'Aktif · berulang' : 'Siap digunakan';
          return <article key={voucher.id} className="rounded-xl border border-slate-800 bg-[#151F32] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white">{voucher.name}</h4>
                <p className="mt-1 text-lg font-extrabold text-emerald-300">{voucherTitle(voucher)}</p>
              </div>
              <span className={'shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ' + (expired || voucher.status === 'USED' ? 'bg-slate-800 text-slate-400' : activeDuration ? 'bg-emerald-500/15 text-emerald-300' : 'bg-blue-500/15 text-blue-300')}>{status}</span>
            </div>
            {voucher.description && <p className="mt-2 text-xs leading-5 text-slate-400">{voucher.description}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-[10px] text-slate-500">
              <span>{voucher.scope_type === 'ALL' ? 'Semua produk' : voucher.scope_type === 'PRODUCT' ? 'Produk tertentu' : 'Kategori tertentu'}</span>
              {activeDuration && <strong className="text-emerald-300">{formatVoucherCountdown(voucher.active_until, voucherNow)}</strong>}
              {!activeDuration && voucher.ends_at && <span>Berlaku sampai {new Date(voucher.ends_at).toLocaleString('id-ID')}</span>}
            </div>
            <p className="mt-2 text-[10px] text-slate-500">{activeDuration ? 'Diskon otomatis diterapkan pada pembelian yang memenuhi ketentuan selama masa aktif.' : voucher.usage_type === 'SINGLE_USE' && !expired && voucher.status === 'READY' ? 'Pilih voucher ini melalui tombol Gunakan Voucher di Step 1 pembelian.' : 'Status voucher mengikuti proses pesanan dan masa berlaku.'}</p>
          </article>;
        })}
      </div> : <div className="rounded-xl border border-dashed border-slate-700 py-12 text-center text-xs text-slate-500">Belum ada voucher di akunmu.</div>}
    </section>}

    {selectedProduct && <div
      className="fixed inset-0 z-[65] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) closeDetails(); }}
    >
      <div className="bg-[#151F32] border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-section-in">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#0F172A]">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Info size={16} className="text-blue-400" />
            Detail & Ulasan Produk
          </h3>
          <button type="button" onClick={closeDetails} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all" aria-label="Tutup detail produk">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs md:text-sm">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-full sm:w-36 h-36 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              {selectedProduct.image_url
                ? <img src={selectedProduct.image_url} alt={selectedProduct.name} className="w-full h-full object-cover" />
                : <div className="flex h-full items-center justify-center"><ShoppingBag size={32} className="text-slate-600" /></div>}
            </div>
            <div className="space-y-2 flex-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                {productBadge(selectedProduct)}
              </span>
              <h2 className="text-lg font-bold text-white">{selectedProduct.name}</h2>
              <div className="text-xl font-extrabold text-blue-400">
                {displayPrice(selectedProduct) <= 0 && selectedProduct.product_type === 'COLLECTIVE_CERTIFICATE'
                  ? 'Harga belum diatur'
                  : formatProductPrice(displayPrice(selectedProduct), selectedProduct.currency)}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                {detailSummary && detailSummary.review_count > 0
                  ? <span className="flex items-center gap-1 text-amber-400 font-bold"><Star size={16} className="fill-amber-400" />{detailSummary.average_rating.toFixed(1)}</span>
                  : <span className="text-slate-500">Belum ada rating</span>}
                <span>•</span>
                <span>{selectedProductSalesCount.toLocaleString('id-ID')} Terjual</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-slate-800/80 pt-4">
            <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider">Deskripsi Lengkap</h4>
            <p className="text-slate-300 leading-relaxed text-xs whitespace-pre-line">{selectedProduct.description || selectedProduct.short_description || productBenefit(selectedProduct)}</p>
          </div>

          <div className="space-y-3 border-t border-slate-800/80 pt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={14} className="text-blue-400" />
                Rating & Ulasan Pembeli
              </h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{detailSummary?.review_count ?? 0} Ulasan</span>
                {canReview && <button type="button" onClick={() => setRatingModalOpen(true)} className="text-[11px] font-semibold text-blue-400 hover:text-blue-300">Beri rating</button>}
              </div>
            </div>

            <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
              {reviewState.loading && !reviewState.rows.length
                ? <p className="text-slate-500 text-xs italic">Memuat ulasan pembeli…</p>
                : reviewState.rows.length ? <>
                    {reviewState.rows.map((review) => (
                      <div key={review.id} className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80 space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">Pembelian terverifikasi</span>
                          <span className="text-[10px] text-slate-500">{formatShortDate(review.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-1"><Stars value={review.rating} size={12} /></div>
                        {review.review && <p className="text-slate-300 text-[11px] leading-relaxed pt-0.5 whitespace-pre-line">{review.review}</p>}
                      </div>
                    ))}
                    {reviewState.hasMore && <button type="button" onClick={() => void loadReviews(selectedProduct.id, reviewState.page + 1, true)} disabled={reviewState.loading} className="w-full rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">Muat ulasan berikutnya</button>}
                  </> : <p className="text-slate-500 text-xs italic">Belum ada ulasan teks untuk produk ini.</p>}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-[#0F172A] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void toggleWishlist(selectedProduct)}
            disabled={!userId || wishlistBusyId === selectedProduct.id}
            className={'px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition active:scale-95 border ' + (detailWishlistSaved
              ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700')}
          >
            <Heart size={16} className={detailWishlistSaved ? 'text-rose-400 fill-rose-400' : 'text-slate-400'} />
            {detailWishlistSaved ? 'Hapus Whitelist' : 'Tambahkan Whitelist'}
          </button>
          <button
            type="button"
            onClick={() => { const product = selectedProduct; const summary = detailSummary; const count = selectedProductSalesCount; closeDetails(); onBuy(product, summary, count); }}
            disabled={getBuyState(selectedProduct).disabled}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50"
          >
            <ShoppingCart size={16} />
            Beli Sekarang
          </button>
        </div>
      </div>
    </div>}

    {ratingModalOpen && selectedProduct && <div
      className="fixed inset-0 z-[75] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) setRatingModalOpen(false); }}
    >
      <form onSubmit={(event) => void submitReview(event)} className="bg-[#151F32] border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-5 space-y-4 animate-section-in">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Star size={16} className="text-amber-400 fill-amber-400" />Berikan Rating & Ulasan</h3>
          <button type="button" onClick={() => setRatingModalOpen(false)} className="text-slate-400 hover:text-white" aria-label="Tutup form rating"><X size={20} /></button>
        </div>
        <div>
          <p className="font-bold text-white text-xs mb-3">{selectedProduct.name}</p>
          <label className="block text-xs font-semibold text-slate-300 mb-2">Pilih Rating Bintang</label>
          <div className="flex items-center gap-2 justify-center py-2 bg-slate-900 rounded-xl border border-slate-800">
            {Array.from({ length: 5 }, (_, index) => {
              const value = index + 1;
              return <button type="button" key={value} onClick={() => setRating(value)} className={'star-btn p-1 ' + (value <= rating ? 'text-amber-400' : 'text-slate-600')} aria-label={value + ' bintang'} aria-pressed={rating === value}>
                <Star size={24} className="fill-current" />
              </button>;
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="shop-review-text">Ulasan Anda (Opsional)</label>
          <textarea id="shop-review-text" rows={3} maxLength={1200} value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="Tuliskan pendapatmu tentang layanan item ini..." className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500" />
          <p className="mt-1 text-right text-[10px] text-slate-500">{reviewText.length}/1200</p>
        </div>
        {notice && <p className="text-xs text-amber-300">{notice}</p>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={() => setRatingModalOpen(false)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Batal</button>
          <button type="submit" disabled={reviewBusy} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 disabled:opacity-50">
            {reviewBusy ? 'Mengirim…' : 'Kirim Ulasan'}
          </button>
        </div>
      </form>
    </div>}
  </div>;
}

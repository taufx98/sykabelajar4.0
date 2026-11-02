import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Loader2, RefreshCw, Save, Star, Upload, ChevronDown, ChevronRight, Heart, MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatShortDate } from '@/lib/utils';
import { uploadImage } from '@/services/cloudinary.service';
import {
  DEFAULT_SHOP_HERO_BANNER,
  getShopHeroBanner,
  listProductReviews,
  listShopAdminInsights,
  saveShopHeroBanner,
  type ProductReview,
  type ShopHeroBanner,
  type ShopAdminInsights,
} from '@/services/shopEngagement.service';
import type { CommerceProduct } from '@/services/commerce.service';

type Props = { products: CommerceProduct[] };
type ProductReviewState = { rows: ProductReview[]; hasMore: boolean; page: number; loading: boolean };

function validCloudinaryUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'res.cloudinary.com'
      && /^\/[^/]+\/image\/upload\/.+/.test(url.pathname);
  } catch {
    return false;
  }
}

function RatingStars({ rating }: { rating: number }) {
  return <span className="inline-flex items-center gap-0.5" aria-label={`Rating ${rating.toFixed(1)} dari 5`}>
    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={13} className={index < Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}/>)}
  </span>;
}

export function ShopInsightsPanel({ products }: Props) {
  const [banner, setBanner] = useState<ShopHeroBanner>(DEFAULT_SHOP_HERO_BANNER);
  const [insights, setInsights] = useState<ShopAdminInsights>({ wishlistCounts: [], reviewSummaries: [] });
  const [loading, setLoading] = useState(true);
  const [savingBanner, setSavingBanner] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState('');
  const [reviewsByProduct, setReviewsByProduct] = useState<Record<string, ProductReviewState>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [hero, data] = await Promise.all([getShopHeroBanner(), listShopAdminInsights()]);
      setBanner(hero);
      setInsights(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Data Shop belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const wishlistRanking = useMemo(() => {
    const counts = new Map(insights.wishlistCounts.map((row) => [row.product_id, row.wishlist_count]));
    return products
      .map((product) => ({ product, count: counts.get(product.id) ?? 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.product.name.localeCompare(b.product.name, 'id'));
  }, [products, insights.wishlistCounts]);

  const reviewSummaries = useMemo(
    () => new Map(insights.reviewSummaries.map((row) => [row.product_id, row])),
    [insights.reviewSummaries],
  );

  const patchBanner = (changes: Partial<ShopHeroBanner>) => {
    setBanner((current) => ({ ...current, ...changes }));
    setSuccess('');
  };

  const uploadBannerImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Pilih file gambar yang valid.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran banner maksimal 5 MB.');
      input.value = '';
      return;
    }
    setUploadingImage(true);
    setError('');
    try {
      const uploaded = await uploadImage(file, 'sykabelajar/shop-hero');
      if (!validCloudinaryUrl(uploaded.secure_url)) throw new Error('URL gambar Cloudinary tidak valid.');
      patchBanner({ image_url: uploaded.secure_url });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Banner belum berhasil diunggah ke Cloudinary.');
    } finally {
      setUploadingImage(false);
      input.value = '';
    }
  };

  const saveBanner = async () => {
    setSavingBanner(true);
    setError('');
    setSuccess('');
    try {
      if (banner.image_url && !validCloudinaryUrl(banner.image_url)) throw new Error('Gambar banner harus berasal dari Cloudinary.');
      await saveShopHeroBanner(banner);
      setSuccess('Pengaturan banner Shop berhasil disimpan.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Pengaturan banner gagal disimpan.');
    } finally {
      setSavingBanner(false);
    }
  };

  const loadReviews = async (productId: string, page = 0, append = false) => {
    setReviewsByProduct((current) => ({
      ...current,
      [productId]: { ...(current[productId] ?? { rows: [], hasMore: false, page: 0 }), loading: true },
    }));
    try {
      const result = await listProductReviews(productId, page);
      setReviewsByProduct((current) => ({
        ...current,
        [productId]: {
          rows: append ? [...(current[productId]?.rows ?? []), ...result.rows] : result.rows,
          hasMore: result.hasMore,
          page,
          loading: false,
        },
      }));
    } catch (reviewError) {
      setReviewsByProduct((current) => ({
        ...current,
        [productId]: { ...(current[productId] ?? { rows: [], hasMore: false, page: 0 }), loading: false },
      }));
      setError(reviewError instanceof Error ? reviewError.message : 'Daftar rating belum dapat dimuat.');
    }
  };

  const toggleProductReviews = (productId: string) => {
    if (expandedProductId === productId) {
      setExpandedProductId('');
      return;
    }
    setExpandedProductId(productId);
    if (!reviewsByProduct[productId]) void loadReviews(productId);
  };

  return <div className="space-y-5">
    <Card className="overflow-hidden border-slate-800 bg-[#111B2C] p-0">
      <div className="border-b border-slate-800 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">Promosi Shop</p><h4 className="mt-1 text-base font-bold text-slate-100">Banner utama katalog</h4><p className="mt-1 text-xs text-slate-400">Konten ini tampil pada halaman Shop seluruh pengguna. Gambar disimpan melalui Cloudinary.</p></div>
          <Badge color={banner.enabled ? 'moss' : 'default'}>{banner.enabled ? 'Aktif' : 'Nonaktif'}</Badge>
        </div>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <label className="block"><span className="label">Label kecil</span><input className="input mt-1 w-full" maxLength={48} value={banner.badge} onChange={(event) => patchBanner({ badge: event.target.value })}/></label>
          <label className="block"><span className="label">Judul banner</span><input className="input mt-1 w-full" maxLength={100} value={banner.title} onChange={(event) => patchBanner({ title: event.target.value })}/></label>
          <label className="block"><span className="label">Deskripsi</span><textarea className="input mt-1 min-h-24 w-full" maxLength={240} value={banner.subtitle} onChange={(event) => patchBanner({ subtitle: event.target.value })}/><span className="mt-1 block text-right text-[10px] text-fg-muted">{banner.subtitle.length}/240</span></label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border surface-border px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-elevated/40">
              <Upload size={14}/>{uploadingImage ? 'Mengunggah…' : banner.image_url ? 'Ganti gambar' : 'Unggah gambar'}
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => void uploadBannerImage(event)} disabled={uploadingImage || savingBanner}/>
            </label>
            {banner.image_url && <button type="button" className="text-xs text-fg-muted hover:text-red-300" onClick={() => patchBanner({ image_url: '' })}>Hapus gambar</button>}
            <label className="inline-flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={banner.enabled} onChange={(event) => patchBanner({ enabled: event.target.checked })}/>Tampilkan banner di Shop</label>
          </div>
          <p className="text-[10px] text-fg-muted">Gambar maksimal 5 MB. Format dan URL hanya dari Cloudinary.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void saveBanner()} disabled={savingBanner || uploadingImage} loading={savingBanner} icon={<Save size={14}/>}>Simpan banner</Button>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || savingBanner}><RefreshCw size={13} className="mr-1"/>Muat ulang</Button>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-300">Pratinjau</p>
          <div className="relative isolate flex min-h-48 flex-col justify-end overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-[#17345C] to-[#101B2C] p-4">
            {banner.image_url && <img src={banner.image_url} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-30"/>}
            <span className="w-fit rounded-full border border-sky-300/30 bg-sky-300/10 px-2 py-1 text-[9px] font-bold text-sky-200">{banner.badge || 'LABEL'}</span>
            <h5 className="mt-3 text-lg font-extrabold leading-tight text-white">{banner.title || 'Judul banner'}</h5>
            <p className="mt-2 text-xs leading-5 text-slate-300">{banner.subtitle || 'Deskripsi banner Shop'}</p>
            {!banner.enabled && <span className="mt-3 w-fit rounded-full bg-slate-950/70 px-2 py-1 text-[9px] text-slate-200">Pratinjau · banner disembunyikan</span>}
          </div>
        </div>
      </div>
    </Card>

    <Card className="overflow-hidden border-slate-800 bg-[#111B2C] p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 sm:p-5">
        <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300"><Heart size={17}/></span><div><h4 className="text-sm font-bold text-slate-100">Produk paling banyak di Whitelist</h4><p className="mt-1 text-[11px] text-slate-400">Peringkat berdasarkan jumlah simpan dari akun pengguna.</p></div></div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'mr-1 animate-spin' : 'mr-1'}/>Segarkan</Button>
      </div>
      {loading ? <div className="flex items-center justify-center gap-2 p-8 text-xs text-slate-400"><Loader2 size={15} className="animate-spin"/>Memuat data Whitelist…</div>
        : wishlistRanking.length ? <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead><tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500"><th className="px-4 py-3">#</th><th className="px-4 py-3">Produk</th><th className="px-4 py-3 text-right">Jumlah WL</th></tr></thead>
            <tbody>{wishlistRanking.map(({ product, count }, index) => <tr key={product.id} className="border-b border-slate-800/70 last:border-0"><td className="px-4 py-3 font-semibold text-slate-500">{index + 1}</td><td className="px-4 py-3"><p className="font-semibold text-slate-200">{product.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{product.code}</p></td><td className="px-4 py-3 text-right font-bold tabular-nums text-rose-300">{count.toLocaleString('id-ID')}</td></tr>)}</tbody>
          </table>
        </div> : <div className="p-8 text-center text-xs text-slate-500">Belum ada produk yang disimpan ke Whitelist.</div>}
    </Card>

    <Card className="overflow-hidden border-slate-800 bg-[#111B2C] p-0">
      <div className="border-b border-slate-800 p-4 sm:p-5"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300"><MessageSquareText size={17}/></span><div><h4 className="text-sm font-bold text-slate-100">Rating & ulasan setiap produk</h4><p className="mt-1 text-[11px] text-slate-400">Hanya ulasan dari transaksi yang sudah dibayar/selesai. Buka produk untuk melihat daftar ulasannya.</p></div></div></div>
      <div className="divide-y divide-slate-800/70">
        {products.map((product) => {
          const summary = reviewSummaries.get(product.id);
          const reviews = reviewsByProduct[product.id];
          const expanded = expandedProductId === product.id;
          return <div key={product.id}>
            <button type="button" onClick={() => toggleProductReviews(product.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.025]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-900">{product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover"/> : <Star size={16} className="text-slate-600"/>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{product.name}</span><span className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">{summary && summary.review_count > 0 ? <><RatingStars rating={summary.average_rating}/><b className="text-slate-300">{summary.average_rating.toFixed(1)}</b><span>{summary.review_count} ulasan</span></> : 'Belum ada rating'}</span></span>
              {expanded ? <ChevronDown size={16} className="shrink-0 text-slate-400"/> : <ChevronRight size={16} className="shrink-0 text-slate-500"/>}
            </button>
            {expanded && <div className="space-y-3 border-t border-slate-800 bg-[#0D1725] p-4">
              {reviews?.loading && !reviews.rows.length ? <p className="flex items-center gap-2 py-3 text-xs text-slate-400"><Loader2 size={14} className="animate-spin"/>Memuat ulasan…</p>
                : reviews?.rows.length ? <div className="space-y-2">
                  {reviews.rows.map((review) => <div key={review.id} className="rounded-xl border border-slate-800 bg-[#111B2C] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><RatingStars rating={review.rating}/><span className="text-[10px] text-slate-500">{formatShortDate(review.created_at)}</span></div>
                    {review.review && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-300">{review.review}</p>}
                    <p className="mt-2 text-[10px] text-emerald-300">Pembelian terverifikasi</p>
                  </div>)}
                  {reviews.hasMore && <Button size="sm" variant="outline" className="w-full border-slate-700 text-slate-200" disabled={reviews.loading} onClick={() => void loadReviews(product.id, reviews.page + 1, true)}>Muat ulasan berikutnya</Button>}
                </div> : <p className="py-3 text-center text-xs text-slate-500">Belum ada ulasan untuk produk ini.</p>}
            </div>}
          </div>;
        })}
        {!products.length && <p className="p-8 text-center text-xs text-slate-500">Belum ada produk untuk ditinjau.</p>}
      </div>
    </Card>
    {(error || success) && <div className={`rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-500/20 bg-red-500/5 text-red-300' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'}`}>{error || success}</div>}
  </div>;
}

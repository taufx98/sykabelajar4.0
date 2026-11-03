import { supabase } from '@/lib/supabase';

export type ShopHeroBanner = {
  enabled: boolean;
  badge: string;
  title: string;
  subtitle: string;
  image_url: string;
};

export type ShopProductCategory = {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export const DEFAULT_SHOP_PRODUCT_CATEGORIES: ShopProductCategory[] = [
  { id: 'edu-coin', label: 'Edu Coin', sort_order: 0, is_active: true },
  { id: 'item-lomba-bypass', label: 'Item Lomba & Bypass', sort_order: 1, is_active: true },
  { id: 'sertifikat-barcode', label: 'Sertifikat & Barcode', sort_order: 2, is_active: true },
  { id: 'voucher-diskon', label: 'Voucher Diskon', sort_order: 3, is_active: true },
];

export type ProductReview = {
  id: string;
  product_id: string;
  rating: number;
  review: string;
  created_at: string;
};

export type ProductReviewSummary = {
  product_id: string;
  average_rating: number;
  review_count: number;
};

export type ProductSalesSummary = {
  product_id: string;
  sales_count: number;
};

export type ShopAdminInsights = {
  wishlistCounts: Array<{ product_id: string; wishlist_count: number }>;
  reviewSummaries: ProductReviewSummary[];
};

export type ProductReviewPage = {
  rows: ProductReview[];
  hasMore: boolean;
};

export const DEFAULT_SHOP_HERO_BANNER: ShopHeroBanner = {
  enabled: true,
  badge: 'Diskon Khusus Peserta Lomba',
  title: 'Dengan membeli produk,\nkamu mendukung website ini untuk terus berkembang!',
  subtitle: 'Dapatkan Edu Coin, Kartu Bypass, Voucher Diskon Pendaftaran, hingga Layanan lainnya untuk menunjang kebutuhanmu.',
  image_url: '',
};

const mapReview = (row: Record<string, unknown>): ProductReview => ({
  id: String(row.id ?? ''),
  product_id: String(row.product_id ?? ''),
  rating: Number(row.rating ?? 0),
  review: String(row.review ?? ''),
  created_at: String(row.created_at ?? ''),
});

export async function getShopHeroBanner(): Promise<ShopHeroBanner> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'shop_hero_banner')
    .maybeSingle();
  if (error) throw error;

  const value = data?.value && typeof data.value === 'object'
    ? data.value as Record<string, unknown>
    : {};
  const isPreviousShopDefault = value.badge === 'SYKABELAJAR SHOP'
    && value.title === 'Kebutuhan belajar dan lomba dalam satu tempat'
    && value.subtitle === 'Temukan produk digital dan layanan resmi yang tersedia di SYKABELAJAR.';
  return {
    enabled: value.enabled !== false,
    badge: isPreviousShopDefault ? DEFAULT_SHOP_HERO_BANNER.badge : String(value.badge ?? DEFAULT_SHOP_HERO_BANNER.badge),
    title: isPreviousShopDefault ? DEFAULT_SHOP_HERO_BANNER.title : String(value.title ?? DEFAULT_SHOP_HERO_BANNER.title),
    subtitle: isPreviousShopDefault ? DEFAULT_SHOP_HERO_BANNER.subtitle : String(value.subtitle ?? DEFAULT_SHOP_HERO_BANNER.subtitle),
    image_url: String(value.image_url ?? ''),
  };
}

export async function saveShopHeroBanner(input: ShopHeroBanner): Promise<void> {
  const value: ShopHeroBanner = {
    enabled: Boolean(input.enabled),
    badge: input.badge.trim().slice(0, 48) || DEFAULT_SHOP_HERO_BANNER.badge,
    title: input.title.trim().slice(0, 100) || DEFAULT_SHOP_HERO_BANNER.title,
    subtitle: input.subtitle.trim().slice(0, 240),
    image_url: input.image_url.trim(),
  };
  const { error } = await supabase
    .from('platform_settings')
    .upsert({ key: 'shop_hero_banner', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

function mapShopProductCategories(value: unknown): ShopProductCategory[] {
  if (!Array.isArray(value)) return DEFAULT_SHOP_PRODUCT_CATEGORIES;
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? '').trim().toLowerCase();
      const label = String(row.label ?? '').trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !label) return null;
      return {
        id,
        label: label.slice(0, 48),
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      };
    })
    .filter((item): item is ShopProductCategory => Boolean(item))
    .sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label, 'id'));
}

export async function getShopProductCategories(): Promise<ShopProductCategory[]> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'shop_product_categories')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SHOP_PRODUCT_CATEGORIES;
  return mapShopProductCategories(data.value);
}

export async function saveShopProductCategories(categories: ShopProductCategory[]): Promise<void> {
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 24) {
    throw new Error('Katalog harus memiliki 1 sampai 24 kategori.');
  }

  const normalized = categories.map((category, index) => ({
    id: String(category.id ?? '').trim().toLowerCase(),
    label: String(category.label ?? '').trim().slice(0, 48),
    sort_order: index,
    is_active: category.is_active !== false,
  }));

  if (normalized.some((category) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id) || category.label.length < 2)) {
    throw new Error('Nama kategori minimal 2 karakter dan ID kategori harus valid.');
  }

  const ids = new Set(normalized.map((category) => category.id));
  const labels = normalized.map((category) => category.label.toLocaleLowerCase('id-ID'));
  if (ids.size !== normalized.length || new Set(labels).size !== normalized.length) {
    throw new Error('Nama kategori tidak boleh duplikat.');
  }

  const { error } = await supabase
    .from('platform_settings')
    .upsert({ key: 'shop_product_categories', value: normalized, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function requireCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('AUTH_REQUIRED');
  return userId;
}

export async function listMyWishlist(): Promise<string[]> {
  const userId = await requireCurrentUserId();
  const { data, error } = await supabase
    .from('commerce_product_wishlist')
    .select('product_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => String(row.product_id));
}

export async function addWishlistItem(productId: string): Promise<void> {
  if (!productId) throw new Error('PRODUCT_REQUIRED');
  const userId = await requireCurrentUserId();
  const { error } = await supabase
    .from('commerce_product_wishlist')
    .upsert({ product_id: productId, user_id: userId }, { onConflict: 'product_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeWishlistItem(productId: string): Promise<void> {
  if (!productId) throw new Error('PRODUCT_REQUIRED');
  const userId = await requireCurrentUserId();
  const { error } = await supabase
    .from('commerce_product_wishlist')
    .delete()
    .eq('product_id', productId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function listProductReviewSummaries(): Promise<ProductReviewSummary[]> {
  const { data, error } = await supabase
    .from('commerce_product_review_summaries')
    .select('product_id,average_rating,review_count');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    product_id: String(row.product_id),
    average_rating: Number(row.average_rating ?? 0),
    review_count: Number(row.review_count ?? 0),
  }));
}

export async function listProductSalesCounts(): Promise<ProductSalesSummary[]> {
  const { data, error } = await supabase.rpc('list_public_commerce_product_sales_counts');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    product_id: String(row.product_id ?? ''),
    sales_count: Number(row.sales_count ?? 0),
  }));
}

export async function hasVerifiedProductPurchase(productId: string): Promise<boolean> {
  if (!productId) return false;
  const userId = await requireCurrentUserId();
  const { data, error } = await supabase
    .from('orders')
    .select('id,order_items!inner(product_ref)')
    .eq('user_id', userId)
    .in('status', ['PAID', 'COMPLETED'])
    .eq('order_items.product_ref', productId)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export async function listProductReviews(productId: string, page = 0, pageSize = 20): Promise<ProductReviewPage> {
  const safePage = Math.max(0, Math.floor(page));
  const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const start = safePage * safeSize;
  const { data, error } = await supabase
    .from('commerce_product_reviews')
    .select('id,product_id,rating,review,created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .range(start, start + safeSize);
  if (error) throw error;
  const rows = (data ?? []).map((row) => mapReview(row as Record<string, unknown>));
  return { rows: rows.slice(0, safeSize), hasMore: rows.length > safeSize };
}

export async function saveProductReview(productId: string, rating: number, review: string): Promise<void> {
  if (!productId) throw new Error('PRODUCT_REQUIRED');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('INVALID_RATING');
  if (review.trim().length > 1200) throw new Error('REVIEW_TOO_LONG');

  const { error } = await supabase.rpc('save_my_commerce_product_review', {
    p_product_id: productId,
    p_rating: rating,
    p_review: review.trim(),
  });
  if (error) throw error;
}

export async function listShopAdminInsights(): Promise<ShopAdminInsights> {
  const [wishlistResult, summaryResult] = await Promise.all([
    supabase.from('commerce_product_wishlist_counts').select('product_id,wishlist_count').order('wishlist_count', { ascending: false }),
    supabase.from('commerce_product_review_summaries').select('product_id,average_rating,review_count'),
  ]);
  if (wishlistResult.error) throw wishlistResult.error;
  if (summaryResult.error) throw summaryResult.error;

  return {
    wishlistCounts: (wishlistResult.data ?? []).map((row) => ({
      product_id: String(row.product_id),
      wishlist_count: Number(row.wishlist_count ?? 0),
    })),
    reviewSummaries: (summaryResult.data ?? []).map((row) => ({
      product_id: String(row.product_id),
      average_rating: Number(row.average_rating ?? 0),
      review_count: Number(row.review_count ?? 0),
    })),
  };
}

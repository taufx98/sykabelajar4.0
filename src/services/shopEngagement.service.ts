import { supabase } from '@/lib/supabase';

export type ShopHeroBanner = {
  enabled: boolean;
  badge: string;
  title: string;
  subtitle: string;
  image_url: string;
};

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
  badge: 'SYKABELAJAR SHOP',
  title: 'Kebutuhan belajar dan lomba dalam satu tempat',
  subtitle: 'Temukan produk digital dan layanan resmi yang tersedia di SYKABELAJAR.',
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
  return {
    enabled: value.enabled !== false,
    badge: String(value.badge ?? DEFAULT_SHOP_HERO_BANNER.badge),
    title: String(value.title ?? DEFAULT_SHOP_HERO_BANNER.title),
    subtitle: String(value.subtitle ?? DEFAULT_SHOP_HERO_BANNER.subtitle),
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

export async function listProductReviews(productId: string, page = 0, pageSize = 20): Promise<ProductReviewPage> {
  const safePage = Math.max(0, Math.floor(page));
  const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const start = safePage * safeSize;
  const { error } = await supabase
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

  const userId = await requireCurrentUserId();
  const { data, error } = await supabase
    .from('commerce_product_reviews')
    .upsert({
      product_id: productId,
      user_id: userId,
      rating,
      review: review.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,product_id' })
    .select('id,product_id,user_id,rating,review,created_at')
    .single();
  if (error) throw error;
  return mapReview(data as Record<string, unknown>);
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

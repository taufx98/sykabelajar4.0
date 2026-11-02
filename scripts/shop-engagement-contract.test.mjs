import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20261103080000_shop_wishlist_ratings_and_banner.sql', 'utf8');
const service = await readFile('src/services/shopEngagement.service.ts', 'utf8');
const shop = await readFile('src/components/shop/ShopExperience.tsx', 'utf8');
const adminPanel = await readFile('src/components/admin/ShopInsightsPanel.tsx', 'utf8');
const adminPage = await readFile('src/pages/AdminPage.tsx', 'utf8');
const ordersPage = await readFile('src/pages/OrdersPage.tsx', 'utf8');
const globalHeader = await readFile('src/components/layout/GlobalHeader.tsx', 'utf8');

test('wishlist is private per user and cannot be written on behalf of another account', () => {
  assert.match(migration, /create table if not exists public\.commerce_product_wishlist/i);
  assert.match(migration, /primary key\s*\(product_id,\s*user_id\)/i);
  assert.match(migration, /auth\.uid\(\)\s*=\s*user_id/i);
  assert.match(migration, /alter table public\.commerce_product_wishlist enable row level security/i);
  assert.match(migration, /grant select, insert, delete on table public\.commerce_product_wishlist to authenticated/i);
});

test('product reviews are verified-purchase-only and ratings are constrained', () => {
  assert.match(migration, /create table if not exists public\.commerce_product_reviews/i);
  assert.match(migration, /check\s*\(\s*rating between 1 and 5\s*\)/i);
  assert.match(migration, /unique\s*\(user_id,\s*product_id\)/i);
  assert.match(migration, /o\.user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration, /o\.status::text in\s*\('PAID',\s*'COMPLETED'\)/i);
  assert.match(migration, /oi\.product_ref\s*=\s*commerce_product_reviews\.product_id::text/i);
  assert.match(migration, /grant select \(id, product_id, rating, review, created_at\) on table public\.commerce_product_reviews to anon, authenticated/i);
  assert.match(migration, /create or replace function public\.save_my_commerce_product_review/i);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(migration, /grant execute on function public\.save_my_commerce_product_review\(uuid, smallint, text\) to authenticated/i);
  assert.match(migration, /as \$shop\$[\s\S]*?\$shop\$;/i);
  assert.match(migration, /VERIFIED_PURCHASE_REQUIRED/);
  assert.doesNotMatch(migration, /grant select on table public\.commerce_product_reviews to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant select \([^)]*user_id[^)]*\) on table public\.commerce_product_reviews/i);
});

test('public aggregate views execute with invoker permissions and have explicit Data API grants', () => {
  assert.match(migration, /create or replace view public\.commerce_product_wishlist_counts with \(security_invoker = true\)/i);
  assert.match(migration, /create or replace view public\.commerce_product_review_summaries with \(security_invoker = true\)/i);
  assert.match(migration, /grant select on public\.commerce_product_wishlist_counts to authenticated/i);
  assert.match(migration, /grant select on public\.commerce_product_review_summaries to anon, authenticated/i);
});

test('shop engagement service stores real wishlist, review and hero settings in Supabase', () => {
  assert.match(service, /from\(['"]commerce_product_wishlist['"]\)/);
  assert.match(service, /from\(['"]commerce_product_reviews['"]\)/);
  assert.match(service, /commerce_product_wishlist_counts/);
  assert.match(service, /commerce_product_review_summaries/);
  assert.match(service, /shop_hero_banner/);
  assert.match(service, /rpc\(['"]save_my_commerce_product_review['"]\)/);
  assert.match(service, /getUser\(/);
  assert.match(service, /hasVerifiedProductPurchase/);
  assert.match(service, /order_items!inner\(product_ref\)/);
});

test('Shop has catalog, order history and product-only whitelist tabs', () => {
  assert.match(shop, /Katalog Shop/);
  assert.match(shop, /Status & History/);
  assert.match(shop, /Whitelist/);
  assert.match(shop, /listMyWishlist/);
  assert.match(shop, /addWishlistItem/);
  assert.match(shop, /removeWishlistItem/);
  assert.match(shop, /listProductReviewSummaries/);
  assert.match(shop, /saveProductReview/);
  assert.match(shop, /grid-cols-2[\s\S]*?xl:grid-cols-4/);
  assert.match(shop, /historyContent/);
});

test('ratings can only be submitted after the current user has a paid or completed order', () => {
  assert.match(service, /\.in\('status', \['PAID', 'COMPLETED'\]\)/);
  assert.match(shop, /hasVerifiedProductPurchase/);
  assert.match(shop, /pembelian terverifikasi/i);
  assert.match(shop, /Ulasan hanya dapat dikirim setelah pesanan dibayar/i);
});

test('admin Shop ranks real wishlist counts and displays real reviews grouped by product', () => {
  assert.match(adminPanel, /listShopAdminInsights/);
  assert.match(adminPanel, /wishlistCounts/);
  assert.match(service, /wishlist_count/);
  assert.match(adminPanel, /review.rating/);
  assert.match(adminPanel, /review.review/);
  assert.match(adminPanel, /Belum ada ulasan/);
  assert.match(adminPanel, /uploadImage/);
  assert.match(adminPage, /ShopInsightsPanel/);
  assert.match(adminPage, /admin\/payment-settings/);
});

test('global header scrolls with the document and the Shop does not add a second sticky heading', () => {
  assert.doesNotMatch(globalHeader, /sticky\s+top-0/);
  assert.doesNotMatch(ordersPage, /sticky top-0 z-20 glass border-b surface-border px-4 py-3/);
  assert.match(ordersPage, /<ShopExperience/);
});

test('the Shop checkout continues to use configured payment methods and existing secure order services', () => {
  assert.match(ordersPage, /listOrganizerPaymentMethods/);
  assert.match(ordersPage, /createProductOrderWithEduCoin/);
  assert.match(ordersPage, /createProductOrderWithProof/);
  assert.match(ordersPage, /createCheckoutPayment/);
  assert.match(ordersPage, /reconcileGatewayPaymentReturn/);
  assert.doesNotMatch(ordersPage, /setPaymentMethod\(gatewayStatus\?\.checkoutEnabled \? 'GATEWAY_GLOBAL' : 'BANK_TRANSFER'\)/);
});

test('admin hero configuration is saved through the existing platform settings row', () => {
  assert.match(adminPanel, /getShopHeroBanner/);
  assert.match(adminPanel, /saveShopHeroBanner/);
  assert.match(adminPanel, /shop_hero_banner/);
  assert.match(adminPanel, /sykabelajar\/shop-hero/);
});

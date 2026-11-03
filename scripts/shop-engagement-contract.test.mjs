import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20261103031139_shop_wishlist_ratings_and_banner.sql', 'utf8');
const grantsMigrationFile = (await readdir('supabase/migrations')).find((file) => /_shop_engagement_minimal_grants\.sql$/.test(file));
const grantsMigration = grantsMigrationFile
  ? await readFile('supabase/migrations/' + grantsMigrationFile, 'utf8')
  : '';
const indexHtml = await readFile('index.html', 'utf8');
const service = await readFile('src/services/shopEngagement.service.ts', 'utf8');
const shop = await readFile('src/components/shop/ShopExperience.tsx', 'utf8');
const adminPanel = await readFile('src/components/admin/ShopInsightsPanel.tsx', 'utf8');
const adminPage = await readFile('src/pages/AdminPage.tsx', 'utf8');
const ordersPage = await readFile('src/pages/OrdersPage.tsx', 'utf8');
const shopProductEditor = await readFile('src/components/admin/ShopProductEditor.tsx', 'utf8');
const globalHeader = await readFile('src/components/layout/GlobalHeader.tsx', 'utf8');

test('wishlist displays PostgREST object errors and explains a missing schema object', () => {
  assert.match(shop, /getWishlistErrorNotice/);
  assert.match(shop, /PGRST205/);
  assert.match(shop, /Whitelist belum tersedia di database Shop/);
});

test('Shop schema migration explicitly refreshes the PostgREST schema cache', () => {
  assert.match(migration, /notify pgrst,\s*'reload schema'/i);
});

test('Shop grants are least-privilege despite permissive project default privileges', () => {
  assert.ok(grantsMigrationFile, 'the explicit Shop grants hardening migration must exist');
  assert.match(grantsMigration, /revoke all on table public\.commerce_product_wishlist\s+from (?:public, )?anon, authenticated/i);
  assert.match(grantsMigration, /grant select,\s*insert,\s*delete on table public\.commerce_product_wishlist\s+to authenticated/i);
  assert.match(grantsMigration, /revoke all on table public\.commerce_product_wishlist_counts\s+from (?:public, )?anon, authenticated/i);
  assert.match(grantsMigration, /grant select on public\.commerce_product_wishlist_counts\s+to authenticated/i);
  assert.match(grantsMigration, /revoke all on table public\.commerce_product_review_summaries\s+from (?:public, )?anon, authenticated/i);
  assert.match(grantsMigration, /grant select on public\.commerce_product_review_summaries\s+to anon, authenticated/i);
  assert.match(grantsMigration, /notify pgrst,\s*'reload schema'/i);
});

test('wishlist is private per user and cannot be written on behalf of another account', () => {
  assert.match(migration, /create table if not exists public\.commerce_product_wishlist/i);
  assert.match(migration, /primary key\s*\(product_id,\s*user_id\)/i);
  assert.match(migration, /\(\s*select auth\.uid\(\)\s*\)\s*=\s*user_id/i);
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
  assert.match(migration, /create or replace view public\.commerce_product_wishlist_counts\s+with \(security_invoker = true\)/i);
  assert.match(migration, /create or replace view public\.commerce_product_review_summaries\s+with \(security_invoker = true\)/i);
  assert.match(migration, /grant select on public\.commerce_product_wishlist_counts to authenticated/i);
  assert.match(migration, /grant select on public\.commerce_product_review_summaries to anon, authenticated/i);
});

test('public sales summary exposes only aggregate quantities from paid or completed Shop orders', () => {
  assert.match(migration, /create or replace function public\.list_public_commerce_product_sales_counts/i);
  assert.match(migration, /returns table \(product_id uuid, sales_count bigint\)/i);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''[\s\S]*?as \$shop\$/i);
  assert.match(migration, /sum\(oi\.quantity\)/i);
  assert.match(migration, /oi\.product_ref = p\.id::text/i);
  assert.match(migration, /oi\.product_type::text = p\.product_type::text/i);
  assert.match(migration, /o\.status::text in \('PAID', 'COMPLETED'\)/i);
  assert.match(migration, /grant execute on function public\.list_public_commerce_product_sales_counts\(\) to anon, authenticated/i);
});

test('shop engagement service stores real wishlist, review and hero settings in Supabase', () => {
  assert.match(service, /from\(['"]commerce_product_wishlist['"]\)/);
  assert.match(service, /from\(['"]commerce_product_reviews['"]\)/);
  assert.match(service, /commerce_product_wishlist_counts/);
  assert.match(service, /commerce_product_review_summaries/);
  assert.match(service, /list_public_commerce_product_sales_counts/);
  assert.match(service, /sales_count/);
  assert.match(service, /shop_hero_banner/);
  assert.match(service, /rpc\(['"]save_my_commerce_product_review['"]\s*,/);
  assert.match(service, /getUser\(/);
  assert.match(service, /hasVerifiedProductPurchase/);
  assert.match(service, /order_items!inner\(product_ref\)/);
});

test('Shop catalog, product cards, toolbar, and detail modal follow the supplied visual reference', () => {
  assert.match(shop, /Katalog Shop/);
  assert.match(shop, /Status & History/);
  assert.match(shop, /Whitelist/);
  assert.match(shop, /listMyWishlist/);
  assert.match(shop, /addWishlistItem/);
  assert.match(shop, /removeWishlistItem/);
  assert.match(shop, /listProductReviewSummaries/);
  assert.match(shop, /listProductSalesCounts/);
  assert.match(shop, /terjual/);
  assert.match(ordersPage, /selectedSalesCount/);
  assert.match(ordersPage, /<QrCode size=\{20\}/);
  assert.match(ordersPage, /<CreditCard size=\{20\}/);
  assert.match(ordersPage, /<UploadCloud size=\{20\}/);
  assert.match(ordersPage, /<Wallet size=\{20\}/);
  assert.match(shop, /saveProductReview/);
  assert.match(shop, /relative h-40 overflow-hidden bg-slate-900/);
  assert.match(shop, /bg-\[#151F32\] border border-slate-800\/90 hover:border-blue-500\/40 rounded-2xl/);
  assert.match(shop, /sticky top-\[10px\] z-10 bg-\[#151F32\]\/95 backdrop-blur-md/);
  assert.match(shop, /Cari item, coin, atau barcode sertifikat/);
  assert.match(shop, /Harga Termahal/);
  assert.match(shop, /Harga Termurah/);
  assert.match(shop, /Rating Tertinggi/);
  assert.match(shop, /Rating Terendah/);
  assert.match(shop, /Paling Populer/);
  assert.match(shop, /grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5/);
  assert.match(shop, /Detail & Ulasan Produk/);
  assert.match(shop, /Favorit & Whitelist Saya/);
  assert.match(shop, /historyContent/);
});

test('Shop typography matches the reference without replacing the application-wide font', () => {
  assert.match(indexHtml, /fonts\.googleapis\.com\/css2\?family=Inter/);
  assert.match(shop, /fontFamily:.*Inter/);
  assert.match(ordersPage, /fontFamily:.*Inter/);
  assert.match(adminPanel, /fontFamily:.*Inter/);
});

test('banner copy and visual defaults match the supplied Shop hero', () => {
  assert.match(service, /badge: 'Diskon Khusus Peserta Lomba'/);
  assert.match(service, /title: 'Dengan membeli produk,\\nkamu mendukung website ini untuk terus berkembang!'/);
  assert.match(service, /Dapatkan Edu Coin, Kartu Bypass, Voucher Diskon Pendaftaran, hingga Layanan lainnya untuk menunjang kebutuhanmu/);
  assert.match(shop, /from-\[#0F172A\] via-\[#1E1B4B\] to-\[#0F172A\]/);
  assert.match(shop, /mix-blend-luminosity/);
  assert.match(shop, /maskImage|WebkitMaskImage/);
  assert.match(adminPanel, /whitespace-pre-line/);
  assert.match(adminPanel, /Baris baru akan dipertahankan/);
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

test('the three-step Shop checkout follows the reference while using configured payment methods and secure order services', () => {
  assert.match(ordersPage, /Detail & Jumlah/);
  assert.match(ordersPage, /Metode Bayar/);
  assert.match(ordersPage, /Konfirmasi/);
  assert.match(ordersPage, /checkoutPaymentMethods\.map/);
  assert.match(ordersPage, /selectedPaymentMethod\.details/);
  assert.match(ordersPage, /createProductOrderWithEduCoin/);
  assert.match(ordersPage, /createProductOrderWithProof/);
  assert.match(ordersPage, /createCheckoutPayment/);
  assert.match(ordersPage, /reconcileGatewayPaymentReturn/);
  assert.doesNotMatch(ordersPage, /88301 0812 3456 7890|8830 123 999|SYKABELAJAR OFFICIAL/);
  assert.doesNotMatch(ordersPage, /setPaymentMethod\(gatewayStatus\?\.checkoutEnabled \? 'GATEWAY_GLOBAL' : 'BANK_TRANSFER'\)/);
});

test('admin banner editor keeps the reference headline line breaks and previews the same layout', () => {
  assert.match(adminPanel, /Judul banner[\s\S]*?textarea/);
  assert.match(adminPanel, /bg-gradient-to-r from-\[#0F172A\] via-\[#1E1B4B\] to-\[#0F172A\]/);
  assert.match(adminPanel, /mix-blend-luminosity/);
  assert.match(adminPanel, /maskImage|WebkitMaskImage/);
});

test('admin hero configuration is saved through the existing platform settings row', () => {
  assert.match(adminPanel, /getShopHeroBanner/);
  assert.match(adminPanel, /saveShopHeroBanner/);
  assert.match(service, /shop_hero_banner/);
  assert.match(adminPanel, /sykabelajar\/shop-hero/);
});


test('WhatsApp is entered in confirmation step and requires at least nine digits', () => {
  const stepOne = ordersPage.slice(
    ordersPage.indexOf('{purchaseStep === 1 &&'),
    ordersPage.indexOf('{purchaseStep === 2 &&'),
  );
  const stepThree = ordersPage.slice(ordersPage.indexOf('{purchaseStep === 3 &&'));
  assert.doesNotMatch(stepOne, /Nomor WhatsApp/);
  assert.match(stepThree, /Nomor WhatsApp/);
  assert.match(ordersPage, /replace\([^)]*\\D[^)]*,\s*['"]{2}\)\.length\s*<\s*9/);
});

test('purchase popup closes only through explicit controls and includes a cancel action', () => {
  assert.doesNotMatch(ordersPage, /event\.target === event\.currentTarget\)\s*close\(\)/);
  assert.match(ordersPage, /aria-label="Tutup pembelian"/);
  assert.match(ordersPage, /Batal/);
});

test('package quantity control is grouped inside the product summary card', () => {
  const stepOne = ordersPage.slice(
    ordersPage.indexOf('{purchaseStep === 1 &&'),
    ordersPage.indexOf('{purchaseStep === 2 &&'),
  );
  const productCardStart = stepOne.indexOf('className="flex gap-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800"');
  const productCardEnd = stepOne.indexOf('</div>\n\n            <div>', productCardStart);
  assert.ok(productCardStart >= 0 && productCardEnd > productCardStart);
  assert.match(stepOne.slice(productCardStart, productCardEnd), /Jumlah Paket/);
});

test('Shop filter catalogue is configured by admin and assigned to products independently from fulfillment type', () => {
  assert.match(service, /shop_product_categories/);
  assert.match(service, /getShopProductCategories/);
  assert.match(service, /saveShopProductCategories/);
  assert.match(adminPanel, /Kelola katalog produk/);
  assert.match(adminPanel, /saveShopProductCategories/);
  assert.match(shop, /getShopProductCategories/);
  assert.match(shop, /categoryOptions\.map/);
  assert.doesNotMatch(shop, /const CATEGORIES:/);
  assert.match(shopProductEditor, /shop_category_id/);
  assert.match(shopProductEditor, /Kategori katalog Shop/);
});

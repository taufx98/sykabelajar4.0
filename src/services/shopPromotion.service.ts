import { supabase } from '@/lib/supabase';

export type ShopVoucherStatus = 'READY' | 'ACTIVE' | 'RESERVED' | 'USED' | 'EXPIRED';
export type ShopVoucherUsage = 'DURATION' | 'SINGLE_USE';
export type ShopVoucherGroup = 'PRICE_DISCOUNT' | 'BUY_X_GET_Y' | 'FREE_SHIPPING';
export type ShopVoucherBenefit = 'PERCENT' | 'FIXED' | 'BUY_X_GET_Y' | 'FREE_SHIPPING';

export interface ShopUserVoucher {
  id: string;
  name: string;
  description: string;
  usage_type: ShopVoucherUsage;
  duration_hours: number | null;
  benefit_group: ShopVoucherGroup;
  benefit_type: ShopVoucherBenefit;
  discount_value: number;
  discount_currency: 'IDR' | 'EDU_COIN';
  scope_type: 'ALL' | 'CATEGORY' | 'PRODUCT';
  starts_at: string;
  ends_at: string | null;
  issued_at: string;
  activated_at: string | null;
  active_until: string | null;
  status: ShopVoucherStatus;
  viewed_at: string | null;
  is_new: boolean;
}

export interface ShopCheckoutVoucher {
  id: string;
  name: string;
  description: string;
  usage_type: ShopVoucherUsage;
  benefit_group: ShopVoucherGroup;
  benefit_type: ShopVoucherBenefit;
  discount_value: number;
  discount_currency: 'IDR' | 'EDU_COIN';
  status: ShopVoucherStatus;
  eligible: boolean;
  reason: string;
  auto_applied: boolean;
  estimated_discount: number;
}

export interface ShopVoucherDefinition {
  id: string;
  name: string;
  description: string;
  usage_type: ShopVoucherUsage;
  duration_hours: number | null;
  benefit_group: ShopVoucherGroup;
  benefit_type: ShopVoucherBenefit;
  discount_value: number;
  discount_currency: 'IDR' | 'EDU_COIN';
  buy_quantity: number;
  free_quantity: number;
  scope_type: 'ALL' | 'CATEGORY' | 'PRODUCT';
  product_ids: string[];
  category_ids: string[];
  min_purchase: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ShopIssuedVoucher {
  id: string;
  username: string;
  voucher_name: string;
  usage_type: ShopVoucherUsage;
  benefit_group: ShopVoucherGroup;
  status: ShopVoucherStatus;
  issued_at: string;
  active_until: string | null;
  used_at: string | null;
}

export interface ShopPromoBanner {
  id: string;
  image_url: string;
  target_url: string | null;
  slide_duration_seconds: number;
  position: number;
  is_active?: boolean;
  views_count?: number;
  clicks_count?: number;
  created_at?: string;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? data as T[] : data && typeof data === 'object' ? [data as T] : [];
}

function mapUserVoucher(row: Record<string, unknown>): ShopUserVoucher {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    usage_type: String(row.usage_type ?? 'SINGLE_USE') as ShopVoucherUsage,
    duration_hours: row.duration_hours == null ? null : Number(row.duration_hours),
    benefit_group: String(row.benefit_group ?? 'PRICE_DISCOUNT') as ShopVoucherGroup,
    benefit_type: String(row.benefit_type ?? 'PERCENT') as ShopVoucherBenefit,
    discount_value: Number(row.discount_value ?? 0),
    discount_currency: String(row.discount_currency ?? 'IDR') as ShopUserVoucher['discount_currency'],
    scope_type: String(row.scope_type ?? 'ALL') as ShopUserVoucher['scope_type'],
    starts_at: String(row.starts_at ?? ''),
    ends_at: row.ends_at == null ? null : String(row.ends_at),
    issued_at: String(row.issued_at ?? ''),
    activated_at: row.activated_at == null ? null : String(row.activated_at),
    active_until: row.active_until == null ? null : String(row.active_until),
    status: String(row.status ?? 'READY') as ShopVoucherStatus,
    viewed_at: row.viewed_at == null ? null : String(row.viewed_at),
    is_new: Boolean(row.is_new),
  };
}

function mapCheckoutVoucher(row: Record<string, unknown>): ShopCheckoutVoucher {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    usage_type: String(row.usage_type ?? 'SINGLE_USE') as ShopVoucherUsage,
    benefit_group: String(row.benefit_group ?? 'PRICE_DISCOUNT') as ShopVoucherGroup,
    benefit_type: String(row.benefit_type ?? 'PERCENT') as ShopVoucherBenefit,
    discount_value: Number(row.discount_value ?? 0),
    discount_currency: String(row.discount_currency ?? 'IDR') as ShopCheckoutVoucher['discount_currency'],
    status: String(row.status ?? 'READY') as ShopVoucherStatus,
    eligible: Boolean(row.eligible),
    reason: String(row.reason ?? ''),
    auto_applied: Boolean(row.auto_applied),
    estimated_discount: Number(row.estimated_discount ?? 0),
  };
}

function mapDefinition(row: Record<string, unknown>): ShopVoucherDefinition {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    usage_type: String(row.usage_type ?? 'SINGLE_USE') as ShopVoucherUsage,
    duration_hours: row.duration_hours == null ? null : Number(row.duration_hours),
    benefit_group: String(row.benefit_group ?? 'PRICE_DISCOUNT') as ShopVoucherGroup,
    benefit_type: String(row.benefit_type ?? 'PERCENT') as ShopVoucherBenefit,
    discount_value: Number(row.discount_value ?? 0),
    discount_currency: String(row.discount_currency ?? 'IDR') as ShopVoucherDefinition['discount_currency'],
    buy_quantity: Number(row.buy_quantity ?? 1),
    free_quantity: Number(row.free_quantity ?? 1),
    scope_type: String(row.scope_type ?? 'ALL') as ShopVoucherDefinition['scope_type'],
    product_ids: Array.isArray(row.product_ids) ? row.product_ids.map(String) : [],
    category_ids: Array.isArray(row.category_ids) ? row.category_ids.map(String) : [],
    min_purchase: Number(row.min_purchase ?? 0),
    starts_at: String(row.starts_at ?? ''),
    ends_at: row.ends_at == null ? null : String(row.ends_at),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at ?? ''),
  };
}

function mapIssuedVoucher(row: Record<string, unknown>): ShopIssuedVoucher {
  return {
    id: String(row.id),
    username: String(row.username ?? ''),
    voucher_name: String(row.voucher_name ?? ''),
    usage_type: String(row.usage_type ?? 'SINGLE_USE') as ShopVoucherUsage,
    benefit_group: String(row.benefit_group ?? 'PRICE_DISCOUNT') as ShopVoucherGroup,
    status: String(row.status ?? 'READY') as ShopVoucherStatus,
    issued_at: String(row.issued_at ?? ''),
    active_until: row.active_until == null ? null : String(row.active_until),
    used_at: row.used_at == null ? null : String(row.used_at),
  };
}

export async function listMyShopVouchers(): Promise<ShopUserVoucher[]> {
  const { data, error } = await supabase.rpc('list_my_shop_vouchers');
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map(mapUserVoucher);
}

export async function markMyShopVouchersSeen(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_my_shop_vouchers_seen');
  if (error) throw error;
  return Number(data ?? 0);
}

export async function listShopCheckoutVouchers(input: {
  productId: string;
  quantity: number;
  subtotal: number;
  shippingCost?: number;
}): Promise<ShopCheckoutVoucher[]> {
  const { data, error } = await supabase.rpc('list_shop_checkout_vouchers', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_subtotal: input.subtotal,
    p_shipping_cost: input.shippingCost ?? 0,
  });
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map(mapCheckoutVoucher);
}

export async function adminListShopVoucherDefinitions(): Promise<ShopVoucherDefinition[]> {
  const { data, error } = await supabase.rpc('admin_list_shop_voucher_definitions');
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map(mapDefinition);
}

export async function adminSaveShopVoucherDefinition(input: Omit<ShopVoucherDefinition, 'created_at'> & { id?: string | null }): Promise<ShopVoucherDefinition> {
  const { data, error } = await supabase.rpc('admin_save_shop_voucher_definition', {
    p_definition: {
      id: input.id ?? null,
      name: input.name.trim(),
      description: input.description.trim(),
      usage_type: input.usage_type,
      duration_hours: input.duration_hours,
      benefit_group: input.benefit_group,
      benefit_type: input.benefit_type,
      discount_value: input.discount_value,
      discount_currency: input.discount_currency,
      buy_quantity: input.buy_quantity,
      free_quantity: input.free_quantity,
      scope_type: input.scope_type,
      product_ids: input.product_ids,
      category_ids: input.category_ids,
      min_purchase: input.min_purchase,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      is_active: input.is_active,
    },
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Voucher gagal disimpan.');
  return mapDefinition(row as Record<string, unknown>);
}

export async function adminIssueShopVoucher(definitionId: string, username: string): Promise<{ id: string; status: ShopVoucherStatus }> {
  const { data, error } = await supabase.rpc('admin_issue_shop_voucher', {
    p_definition_id: definitionId,
    p_username: username.trim().replace(/^@/, ''),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Voucher gagal diberikan.');
  return { id: String(row.id), status: String(row.status) as ShopVoucherStatus };
}

export async function adminListIssuedShopVouchers(): Promise<ShopIssuedVoucher[]> {
  const { data, error } = await supabase.rpc('admin_list_issued_shop_vouchers');
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map(mapIssuedVoucher);
}

export async function listActiveShopPromoBanners(): Promise<ShopPromoBanner[]> {
  const { data, error } = await supabase.rpc('list_active_shop_promo_banners');
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    image_url: String(row.image_url ?? ''),
    target_url: row.target_url == null ? null : String(row.target_url),
    slide_duration_seconds: Number(row.slide_duration_seconds ?? 5),
    position: Number(row.position ?? 0),
  }));
}

export async function adminListShopPromoBanners(): Promise<ShopPromoBanner[]> {
  const { data, error } = await supabase.rpc('admin_list_shop_promo_banners');
  if (error) throw error;
  return rows<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    image_url: String(row.image_url ?? ''),
    target_url: row.target_url == null ? null : String(row.target_url),
    slide_duration_seconds: Number(row.slide_duration_seconds ?? 5),
    position: Number(row.position ?? 0),
    is_active: Boolean(row.is_active),
    views_count: Number(row.views_count ?? 0),
    clicks_count: Number(row.clicks_count ?? 0),
    created_at: String(row.created_at ?? ''),
  }));
}

export async function adminSaveShopPromoBanner(input: {
  id?: string | null;
  imageUrl: string;
  targetUrl?: string | null;
  durationSeconds: number;
  position: number;
  isActive: boolean;
}): Promise<ShopPromoBanner> {
  const { data, error } = await supabase.rpc('admin_save_shop_promo_banner', {
    p_id: input.id ?? null,
    p_image_url: input.imageUrl.trim(),
    p_target_url: input.targetUrl?.trim() || null,
    p_slide_duration_seconds: input.durationSeconds,
    p_position: input.position,
    p_is_active: input.isActive,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Banner gagal disimpan.');
  return {
    id: String(row.id),
    image_url: String(row.image_url ?? ''),
    target_url: row.target_url == null ? null : String(row.target_url),
    slide_duration_seconds: Number(row.slide_duration_seconds ?? 5),
    position: Number(row.position ?? 0),
    is_active: Boolean(row.is_active),
    views_count: Number(row.views_count ?? 0),
    clicks_count: Number(row.clicks_count ?? 0),
  };
}

export async function adminDeleteShopPromoBanner(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_delete_shop_promo_banner', { p_id: id });
  if (error) throw error;
  return Boolean(data);
}

export async function recordShopPromoBannerEvent(bannerId: string, eventType: 'VIEW' | 'CLICK', visitorKey: string): Promise<void> {
  const { error } = await supabase.rpc('record_shop_promo_banner_event', {
    p_banner_id: bannerId,
    p_event_type: eventType,
    p_visitor_key: visitorKey,
  });
  if (error) throw error;
}

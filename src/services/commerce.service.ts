import { supabase } from '@/lib/supabase';

export interface CommerceProduct {
  id: string;
  code: string;
  slug: string;
  name: string;
  short_description: string | null;
  product_type: string;
  audiences: string[] | null;
  price: number;
  currency: string;
  image_url: string | null;
  public_id: string | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
}

export interface OrganizerPlanCatalogRow {
  plan_code: string;
  name: string;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  currency: string;
  sort_order: number;
  is_active: boolean;
}

export interface OrganizerPlanBenefit {
  plan_code: string;
  capability: string;
  limit_value: number | null;
  config: Record<string, unknown>;
}

export async function listActiveProducts(): Promise<CommerceProduct[]> {
  const { data, error } = await supabase
    .from('commerce_products')
    .select('id,code,slug,name,short_description,product_type,audiences,price,currency,image_url,public_id,is_active,is_featured,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    code: String(p.code ?? ''),
    slug: String(p.slug ?? ''),
    name: String(p.name ?? ''),
    short_description: p.short_description == null ? null : String(p.short_description),
    product_type: String(p.product_type ?? ''),
    audiences: Array.isArray(p.audiences) ? p.audiences.map(String) : null,
    price: Number(p.price ?? 0),
    currency: String(p.currency ?? 'IDR'),
    image_url: p.image_url == null ? null : String(p.image_url),
    public_id: p.public_id == null ? null : String(p.public_id),
    is_active: Boolean(p.is_active),
    is_featured: Boolean(p.is_featured),
    sort_order: Number(p.sort_order ?? 0),
  }));
}

export async function listActiveOrganizerPlans(): Promise<OrganizerPlanCatalogRow[]> {
  const { data, error } = await supabase
    .from('plan_catalog')
    .select('plan_code,name,description,monthly_price,yearly_price,currency,sort_order,is_active')
    .eq('is_active', true)
    .in('plan_code', ['PREMIUM', 'PRO'])
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
    plan_code: String(p.plan_code),
    name: String(p.name ?? p.plan_code),
    description: p.description == null ? null : String(p.description),
    monthly_price: Number(p.monthly_price ?? 0),
    yearly_price: Number(p.yearly_price ?? 0),
    currency: String(p.currency ?? 'IDR'),
    sort_order: Number(p.sort_order ?? 0),
    is_active: Boolean(p.is_active),
  }));
}

export async function listOrganizerPlanBenefits(planCodes: string[]): Promise<OrganizerPlanBenefit[]> {
  const normalized = [...new Set(planCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return [];
  const { data, error } = await supabase
    .from('plan_entitlements')
    .select('plan_code,capability,limit_value,config')
    .in('plan_code', normalized)
    .order('plan_code')
    .order('capability');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    plan_code: String(row.plan_code),
    capability: String(row.capability),
    limit_value: row.limit_value == null ? null : Number(row.limit_value),
    config: row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {},
  }));
}

export async function createOrganizerPlanOrderV2(input: {
  organizerId: string;
  planCode: string;
  billingPeriod: 'MONTHLY' | 'YEARLY';
  whatsapp: string;
  proofUrl: string;
  proofPublicId?: string;
  proofWidth?: number;
  proofHeight?: number;
  proofVersion?: string;
  proofResourceType?: string;
}) {
  if (!input.organizerId) throw new Error('Organisasi wajib dipilih.');
  if (!['PREMIUM', 'PRO'].includes(input.planCode.toUpperCase())) throw new Error('Plan berbayar tidak valid.');
  if (!input.whatsapp.trim()) throw new Error('WhatsApp wajib diisi.');
  if (!input.proofUrl.trim()) throw new Error('Bukti pembayaran wajib diisi.');

  const { data, error } = await supabase.rpc('create_organizer_plan_order_v2', {
    p_organizer_id: input.organizerId,
    p_plan_code: input.planCode.toUpperCase(),
    p_billing_period: input.billingPeriod,
    p_whatsapp: input.whatsapp.trim(),
    p_proof_url: input.proofUrl.trim(),
    p_proof_public_id: input.proofPublicId ?? null,
    p_proof_width: input.proofWidth ?? null,
    p_proof_height: input.proofHeight ?? null,
    p_proof_version: input.proofVersion ?? null,
    p_proof_resource_type: input.proofResourceType ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function requestCustomOrganizerPlan(input: {
  organizerId: string;
  requestedFeatures: string[];
  notes?: string;
  contactWhatsapp?: string;
}) {
  const features = input.requestedFeatures.map((x) => x.trim()).filter(Boolean);
  if (!input.organizerId) throw new Error('Organisasi wajib dipilih.');
  if (!features.length) throw new Error('Pilih minimal satu fitur custom.');

  const requestedFeatures = { features };
  const { data, error } = await supabase.rpc('request_custom_organizer_plan', {
    p_organizer_id: input.organizerId,
    p_requested_features: requestedFeatures,
    p_notes: input.notes?.trim() || null,
    p_contact_whatsapp: input.contactWhatsapp?.trim() || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function createProductOrder(productId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Jumlah produk tidak valid.');
  const { data, error } = await supabase.rpc('create_product_order', {
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function createProductOrderWithProof(input: {
  productId: string;
  quantity: number;
  whatsapp: string;
  paymentMethod: string;
  proofUrl: string;
  proofPublicId?: string;
  proofWidth?: number;
  proofHeight?: number;
  proofVersion?: string;
  proofResourceType?: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Jumlah produk tidak valid.');
  const { data, error } = await supabase.rpc('create_product_order_with_proof', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_whatsapp: input.whatsapp.trim(),
    p_payment_method: input.paymentMethod,
    p_proof_url: input.proofUrl,
    p_proof_public_id: input.proofPublicId ?? null,
    p_proof_width: input.proofWidth ?? null,
    p_proof_height: input.proofHeight ?? null,
    p_proof_version: input.proofVersion ?? null,
    p_proof_resource_type: input.proofResourceType ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function adminReviewManualOrder(orderId: string, decision: 'APPROVE' | 'REJECT', reason = '') {
  const { data, error } = await supabase.rpc('admin_review_manual_order', {
    p_order_id: orderId,
    p_decision: decision,
    p_reason: reason.trim() || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

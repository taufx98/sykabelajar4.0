import { supabase } from '@/lib/supabase';
import { uploadImage } from './cloudinary.service';

export interface AdBannerSettings {
  id: string;
  slide_duration_seconds: number;
  min_duration_seconds: number;
  max_duration_seconds: number;
  price_per_lot_daily: number;
  bundle_discount_3lots: number;
  bundle_discount_5lots: number;
  single_image_2slots_price: number;
  single_image_3slots_price: number;
}

export interface AdBannerRequest {
  id: string;
  organizer_id: string;
  user_id: string;
  image_url: string;
  image_urls?: string[];
  link_url: string;
  slots_requested: number;
  single_image: boolean;
  duration_days: number;
  total_price: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  admin_note?: string;
  reviewed_at?: string;
  created_at: string;
  organizer_name?: string;
}

export interface AdBanner {
  id: string;
  slot_number: number;
  image_url: string;
  image_urls?: string[];
  link_url: string;
  single_image: boolean;
  image_width_slots: number;
  slide_duration_seconds: number;
  expires_at: string;
  organizer_name?: string;
}

// ── Public: load active banners ──
export async function loadActiveBanners(): Promise<AdBanner[]> {
  const { data, error } = await supabase
    .from('ad_banners')
    .select('*')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('slot_number', { ascending: true });
  if (error) {
    console.warn('[AdBanner] load failed:', error.message);
    return [];
  }
  return (data ?? []) as AdBanner[];
}

// ── Public: load settings ──
export async function loadBannerSettings(): Promise<AdBannerSettings | null> {
  const { data } = await supabase
    .from('ad_banner_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  return (data as AdBannerSettings) ?? null;
}

// ── Organizer: submit banner request ──
export async function submitBannerRequest(params: {
  organizerId: string;
  file?: File;
  imageUrls?: string[];
  linkUrl: string;
  slotsRequested: number;
  singleImage: boolean;
  durationDays: number;
  totalPrice: number;
}): Promise<AdBannerRequest> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  let primaryUrl: string;
  let allUrls: string[] = [];

  if (params.imageUrls && params.imageUrls.length > 0) {
    // Multiple pre-uploaded URLs
    allUrls = params.imageUrls;
    primaryUrl = params.imageUrls[0];
  } else if (params.file) {
    // Single file upload (backward compat)
    const result = await uploadImage(
      params.file,
      `sykabelajar/banners/${params.organizerId}/${params.slotsRequested}slot_${Date.now()}`
    );
    primaryUrl = result.secure_url;
    allUrls = [primaryUrl];
  } else {
    throw new Error('No images provided');
  }

  const { data, error } = await supabase
    .from('ad_banner_requests')
    .insert({
      organizer_id: params.organizerId,
      user_id: auth.user.id,
      image_url: primaryUrl,
      image_urls: allUrls,
      link_url: params.linkUrl,
      slots_requested: params.slotsRequested,
      single_image: params.singleImage,
      duration_days: params.durationDays,
      total_price: params.totalPrice,
      status: 'PENDING',
    })
    .select()
    .single();
  if (error) throw error;
  return data as AdBannerRequest;
}

// ── Organizer: my requests ──
export async function loadMyBannerRequests(): Promise<AdBannerRequest[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data } = await supabase
    .from('ad_banner_requests')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });
  return (data ?? []) as AdBannerRequest[];
}

// ── Admin: all requests ──
export async function loadAllBannerRequests(): Promise<AdBannerRequest[]> {
  const { data } = await supabase
    .from('ad_banner_requests')
    .select('*')
    .order('created_at', { ascending: false });
  return (data ?? []) as AdBannerRequest[];
}

// ── Admin: approve request → create/update ad_banners ──
export async function approveBannerRequest(
  requestId: string,
  settings: AdBannerSettings
): Promise<void> {
  const { data: req, error: reqErr } = await supabase
    .from('ad_banner_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (reqErr || !req) throw reqErr ?? new Error('Request not found');

  // Find next available slot numbers
  const { data: existing } = await supabase
    .from('ad_banners')
    .select('slot_number')
    .eq('is_active', true)
    .order('slot_number', { ascending: true });

  const usedSlots = new Set((existing ?? []).map((b: any) => b.slot_number));
  const startSlot = (() => {
    let s = 1;
    while (usedSlots.has(s)) s++;
    return s;
  })();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + req.duration_days);

  // Use image_urls array if available, fallback to single image_url
  const urls: string[] = req.image_urls?.length ? req.image_urls : [req.image_url];

  const bannersToInsert: any[] = [];
  if (req.single_image) {
    // One image fills multiple slots
    bannersToInsert.push({
      request_id: req.id,
      organizer_id: req.organizer_id,
      user_id: req.user_id,
      slot_number: startSlot,
      image_url: urls[0],
      image_urls: urls,
      link_url: req.link_url,
      single_image: true,
      image_width_slots: req.slots_requested,
      slide_duration_seconds: settings.slide_duration_seconds,
      expires_at: expiresAt.toISOString(),
      is_active: true,
    });
  } else {
    // Multiple separate images — one per slot
    for (let i = 0; i < req.slots_requested; i++) {
      bannersToInsert.push({
        request_id: req.id,
        organizer_id: req.organizer_id,
        user_id: req.user_id,
        slot_number: startSlot + i,
        image_url: urls[i] || urls[0],
        image_urls: urls,
        link_url: req.link_url,
        single_image: false,
        image_width_slots: 1,
        slide_duration_seconds: settings.slide_duration_seconds,
        expires_at: expiresAt.toISOString(),
        is_active: true,
      });
    }
  }

  // Upsert banners (replace if slot occupied by same organizer)
  for (const banner of bannersToInsert) {
    const { error: upErr } = await supabase
      .from('ad_banners')
      .upsert(banner, { onConflict: 'slot_number' });
    if (upErr) console.warn('[AdBanner] upsert failed:', upErr.message);
  }

  // Update request status
  await supabase
    .from('ad_banner_requests')
    .update({ status: 'APPROVED', reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
}

// ── Admin: reject request ──
export async function rejectBannerRequest(requestId: string, note: string): Promise<void> {
  await supabase
    .from('ad_banner_requests')
    .update({
      status: 'REJECTED',
      admin_note: note,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);
}

// ── Admin: update settings ──
export async function updateBannerSettings(settings: Partial<AdBannerSettings>): Promise<void> {
  const { data: existing } = await supabase
    .from('ad_banner_settings')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (existing) {
    await supabase.from('ad_banner_settings').update(settings).eq('id', existing.id);
  } else {
    await supabase.from('ad_banner_settings').insert(settings);
  }
}

// ── Admin: deactivate banner ──
export async function deactivateBanner(bannerId: string): Promise<void> {
  await supabase.from('ad_banners').update({ is_active: false }).eq('id', bannerId);
}

// ── Helper: calculate price ──
export function calculateBannerPrice(
  settings: AdBannerSettings,
  slots: number,
  durationDays: number,
  singleImage: boolean
): number {
  if (singleImage && slots === 2) return settings.single_image_2slots_price * durationDays;
  if (singleImage && slots === 3) return settings.single_image_3slots_price * durationDays;

  let base = settings.price_per_lot_daily * slots * durationDays;
  if (slots >= 3) base *= (1 - settings.bundle_discount_3lots / 100);
  else if (slots >= 5) base *= (1 - settings.bundle_discount_5lots / 100);
  return Math.round(base);
}


// ── Platform Settings (admin banks, WhatsApp, chat) ──
export interface AdminBank {
  bank: string;
  name: string;
  number: string;
}

export interface PlatformSettings {
  admin_banks: AdminBank[];
  whatsapp_number: string;
  chat_enabled: boolean;
  chat_type: 'whatsapp' | 'internal';
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  admin_banks: [
    { bank: 'BCA', name: 'PT Syka Belajar', number: '1234567890' },
    { bank: 'BRI', name: 'PT Syka Belajar', number: '0987654321' },
  ],
  whatsapp_number: '6281234567890',
  chat_enabled: true,
  chat_type: 'whatsapp',
};

export async function loadPlatformSettings(): Promise<PlatformSettings> {
  const { data } = await supabase
    .from('platform_settings')
    .select('key, value');
  if (!data || data.length === 0) return DEFAULT_PLATFORM_SETTINGS;
  const result = { ...DEFAULT_PLATFORM_SETTINGS };
  for (const row of data) {
    const key = row.key as keyof PlatformSettings;
    if (key in result) {
      (result as any)[key] = row.value;
    }
  }
  return result;
}

export async function updatePlatformSetting(key: string, value: any): Promise<void> {
  const { data: existing } = await supabase
    .from('platform_settings')
    .select('id')
    .eq('key', key)
    .maybeSingle();
  if (existing) {
    await supabase.from('platform_settings').update({ value, updated_at: new Date().toISOString() }).eq('id', existing.id);
  } else {
    await supabase.from('platform_settings').insert({ key, value });
  }
}

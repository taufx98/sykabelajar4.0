import { supabase } from '@/lib/supabase';
import { uploadImage } from './cloudinary.service';
import { env } from '@/lib/env';

export type MediaType = 'image' | 'gif' | 'video';

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
  media_type?: MediaType;
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
  media_type: MediaType;
  link_url: string;
  single_image: boolean;
  image_width_slots: number;
  slide_duration_seconds: number;
  expires_at: string;
  is_active: boolean;
  organizer_name?: string;
  title?: string;
  created_at?: string;
}

// ── Upload helper for any media type ──
export async function uploadBannerMedia(
  file: File,
  folder: string
): Promise<{ secure_url: string; public_id: string; media_type: MediaType }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isVideo = ext === 'mp4' || file.type === 'video/mp4';
  const isGif = ext === 'gif' || file.type === 'image/gif';

  // Validate size: max 2MB for video/gif, 5MB for images
  const maxSize = isVideo || isGif ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > maxSize) {
    const mb = Math.round(maxSize / 1024 / 1024);
    throw new Error(`Ukuran file maksimal ${mb}MB untuk ${isVideo ? 'video' : isGif ? 'GIF' : 'gambar'}.`);
  }

  if (isVideo) {
    // Upload video to Cloudinary as video resource
    const cloudName = env.cloudinaryCloudName;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', env.cloudinaryUploadPreset);
    formData.append('folder', folder);
    formData.append('resource_type', 'video');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error(`Upload video gagal (${response.status})`);
    const result = await response.json();
    return { secure_url: result.secure_url, public_id: result.public_id, media_type: 'video' };
  }

  if (isGif) {
    // Upload GIF as image (Cloudinary preserves animation)
    const result = await uploadImage(file, folder);
    return { secure_url: result.secure_url, public_id: result.public_id, media_type: 'gif' };
  }

  // Regular image
  const result = await uploadImage(file, folder);
  return { secure_url: result.secure_url, public_id: result.public_id, media_type: 'image' };
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
  return (data ?? []).map((r: any) => ({
    ...r,
    media_type: r.media_type || 'image',
  })) as AdBanner[];
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
  mediaType?: MediaType;
}): Promise<AdBannerRequest> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  let primaryUrl: string;
  let allUrls: string[] = [];
  let mediaType: MediaType = params.mediaType || 'image';

  if (params.imageUrls && params.imageUrls.length > 0) {
    allUrls = params.imageUrls;
    primaryUrl = params.imageUrls[0];
  } else if (params.file) {
    const uploaded = await uploadBannerMedia(
      params.file,
      `sykabelajar/banners/${params.organizerId}/${params.slotsRequested}slot_${Date.now()}`
    );
    primaryUrl = uploaded.secure_url;
    allUrls = [primaryUrl];
    mediaType = uploaded.media_type;
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
      media_type: mediaType,
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

  const urls: string[] = req.image_urls?.length ? req.image_urls : [req.image_url];
  const mediaType: MediaType = (req as any).media_type || 'image';

  const bannersToInsert: any[] = [];
  if (req.single_image) {
    bannersToInsert.push({
      request_id: req.id,
      organizer_id: req.organizer_id,
      user_id: req.user_id,
      slot_number: startSlot,
      image_url: urls[0],
      image_urls: urls,
      media_type: mediaType,
      link_url: req.link_url,
      single_image: true,
      image_width_slots: req.slots_requested,
      slide_duration_seconds: settings.slide_duration_seconds,
      expires_at: expiresAt.toISOString(),
      is_active: true,
    });
  } else {
    for (let i = 0; i < req.slots_requested; i++) {
      bannersToInsert.push({
        request_id: req.id,
        organizer_id: req.organizer_id,
        user_id: req.user_id,
        slot_number: startSlot + i,
        image_url: urls[i] || urls[0],
        image_urls: urls,
        media_type: mediaType,
        link_url: req.link_url,
        single_image: false,
        image_width_slots: 1,
        slide_duration_seconds: settings.slide_duration_seconds,
        expires_at: expiresAt.toISOString(),
        is_active: true,
      });
    }
  }

  for (const banner of bannersToInsert) {
    const { error: upErr } = await supabase
      .from('ad_banners')
      .upsert(banner, { onConflict: 'slot_number' });
    if (upErr) console.warn('[AdBanner] upsert failed:', upErr.message);
  }

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

// ── Admin: deactivate banner (takedown) ──
export async function deactivateBanner(bannerId: string): Promise<void> {
  await supabase.from('ad_banners').update({ is_active: false }).eq('id', bannerId);
}

// ── Admin: add banner directly (skip request flow) ──
export async function adminAddBanner(params: {
  file: File;
  slotNumber: number;
  widthSlots: number;
  linkUrl: string;
  title?: string;
  durationDays: number;
  slideDuration: number;
}): Promise<AdBanner> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  const uploaded = await uploadBannerMedia(
    params.file,
    `sykabelajar/banners/admin/${Date.now()}`
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + params.durationDays);

  const { data, error } = await supabase
    .from('ad_banners')
    .insert({
      slot_number: params.slotNumber,
      image_url: uploaded.secure_url,
      image_urls: [uploaded.secure_url],
      media_type: uploaded.media_type,
      link_url: params.linkUrl,
      title: params.title || '',
      single_image: params.widthSlots > 1,
      image_width_slots: params.widthSlots,
      slide_duration_seconds: params.slideDuration,
      expires_at: expiresAt.toISOString(),
      is_active: true,
      organizer_id: null,
      user_id: auth.user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...data, media_type: uploaded.media_type } as AdBanner;
}

// ── Admin: update banner ──
export async function adminUpdateBanner(bannerId: string, patch: Partial<AdBanner>): Promise<void> {
  const { error } = await supabase
    .from('ad_banners')
    .update(patch)
    .eq('id', bannerId);
  if (error) throw error;
}

// ── Admin: delete banner permanently ──
export async function adminDeleteBanner(bannerId: string): Promise<void> {
  const { error } = await supabase
    .from('ad_banners')
    .delete()
    .eq('id', bannerId);
  if (error) throw error;
}

// ── Admin: get all slots (including inactive) ──
export async function adminLoadAllBanners(): Promise<AdBanner[]> {
  const { data, error } = await supabase
    .from('ad_banners')
    .select('*')
    .order('slot_number', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    media_type: r.media_type || 'image',
  })) as AdBanner[];
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

// ── Platform Settings ──
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

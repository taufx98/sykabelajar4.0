import { supabase } from '@/lib/supabase';
import type { BannerPlacement } from '@/services/ad.service';

export interface PublicBanner {
  id: string;
  title: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
  slot_number: number;
  created_at: string;
  placement: BannerPlacement;
  media_type: 'image' | 'gif' | 'video';
  image_urls?: string[];
  single_image: boolean;
  image_width_slots: number;
  slide_duration_seconds: number;
}

const CACHE_KEY = 'syka.public.v3.banners';
const CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 10 * 60_000;
const memory = new Map<BannerPlacement, { expiresAt: number; data: PublicBanner[] }>();
const failureUntil = new Map<BannerPlacement, number>();
const inFlight = new Map<BannerPlacement, Promise<PublicBanner[]>>();

function placementCacheKey(placement: BannerPlacement) {
  return `${CACHE_KEY}.${placement}`;
}

function readCache(placement: BannerPlacement): PublicBanner[] | null {
  try {
    const raw = sessionStorage.getItem(placementCacheKey(placement));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; data: PublicBanner[] };
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(placementCacheKey(placement));
      return null;
    }
    return parsed.data ?? [];
  } catch {
    return null;
  }
}

function writeCache(placement: BannerPlacement, data: PublicBanner[]) {
  try {
    sessionStorage.setItem(placementCacheKey(placement), JSON.stringify({
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    }));
  } catch {
    // Session storage is optional; memory remains authoritative for this tab.
  }
}

/**
 * Reuses the existing public banner query/cache and filters by its new placement
 * field. Keeping placement-specific cache entries prevents the top and sidebar
 * from accidentally receiving one another's banners.
 */
export async function loadPublicBanners(placement: BannerPlacement = 'home_top'): Promise<PublicBanner[]> {
  const now = Date.now();
  const cachedMemory = memory.get(placement);
  if (cachedMemory && cachedMemory.expiresAt > now) return cachedMemory.data;

  const cached = readCache(placement);
  if (cached) {
    memory.set(placement, { expiresAt: now + CACHE_TTL_MS, data: cached });
    return cached;
  }

  if ((failureUntil.get(placement) ?? 0) > now) return [];
  const pending = inFlight.get(placement);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from('ad_banners')
      .select('id,title,image_url,link_url,is_active,sort_order,slot_number,created_at,placement,image_width_slots,single_image,slide_duration_seconds,media_type')
      .eq('is_active', true)
      .eq('placement', placement)
      .order('slot_number', { ascending: true })
      .limit(5);

    if (error) {
      failureUntil.set(placement, Date.now() + NEGATIVE_CACHE_TTL_MS);
      console.warn('[PublicBanner] disabled until retry window expires:', error.message);
      return [];
    }

    const result = (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      image_url: String(row.image_url ?? ''),
      link_url: String(row.link_url ?? ''),
      is_active: Boolean(row.is_active),
      slot_number: Number(row.slot_number ?? row.sort_order ?? 0),
      created_at: String(row.created_at ?? ''),
      placement: (row.placement || 'home_top') as BannerPlacement,
      media_type: (row.media_type || 'image') as PublicBanner['media_type'],
      single_image: Boolean(row.single_image ?? false),
      image_width_slots: Math.max(1, Math.min(3, Number(row.image_width_slots ?? 1) || 1)),
      slide_duration_seconds: Math.min(
        120,
        Math.max(5, Number(row.slide_duration_seconds ?? 45) || 45),
      ),
    }));

    memory.set(placement, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
    failureUntil.delete(placement);
    writeCache(placement, result);
    return result;
  })();

  inFlight.set(placement, request);
  try {
    return await request;
  } finally {
    inFlight.delete(placement);
  }
}

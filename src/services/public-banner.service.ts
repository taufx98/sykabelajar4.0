import { supabase } from '@/lib/supabase';

export interface PublicBanner {
  id: string;
  title: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
  slot_number: number;
  created_at: string;
  media_type: 'image';
  image_urls?: string[];
  single_image: boolean;
  image_width_slots: number;
  slide_duration_seconds: number;
}

const CACHE_KEY = 'syka.public.v1.banners';
const CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 10 * 60_000;
let memory: { expiresAt: number; data: PublicBanner[] } | null = null;
let failureUntil = 0;
let inFlight: Promise<PublicBanner[]> | null = null;

function readCache(): PublicBanner[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; data: PublicBanner[] };
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data ?? [];
  } catch {
    return null;
  }
}

function writeCache(data: PublicBanner[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }));
  } catch {
    // Session storage is optional; memory remains authoritative for this tab.
  }
}

export async function loadPublicBanners(): Promise<PublicBanner[]> {
  const now = Date.now();
  if (memory && memory.expiresAt > now) return memory.data;
  const cached = readCache();
  if (cached) {
    memory = { expiresAt: now + CACHE_TTL_MS, data: cached };
    return cached;
  }
  if (failureUntil > now) return [];
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { data, error } = await supabase
      .from('ad_banners')
      .select('id,title,image_url,link_url,is_active,sort_order,created_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(5);
    if (error) {
      failureUntil = Date.now() + NEGATIVE_CACHE_TTL_MS;
      console.warn('[PublicBanner] disabled until retry window expires:', error.message);
      return [];
    }
    const result = (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      image_url: String(row.image_url ?? ''),
      link_url: String(row.link_url ?? ''),
      is_active: Boolean(row.is_active),
      slot_number: Number(row.sort_order ?? 0),
      created_at: String(row.created_at ?? ''),
      media_type: 'image' as const,
      single_image: false,
      image_width_slots: 1,
      slide_duration_seconds: 45,
    }));
    memory = { expiresAt: Date.now() + CACHE_TTL_MS, data: result };
    failureUntil = 0;
    writeCache(result);
    return result;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

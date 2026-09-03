import { supabase } from '@/lib/supabase';
import { CACHE_TTL, CACHE_VERSION, userCacheKey } from '@/lib/cacheRegistry';
import { getPersistentCache, removePersistentCache, setPersistentCache } from '@/lib/persistentCache';

const AUTH_PROFILE_FIELDS = 'id,username,full_name,account_type,bio,institution,grade,birth_date,subjects,avatar_url,cover_url,status,created_at,pembina,badge_showcase,badge_showcase_manual';

export async function getProfileById(userId: string) {
  const key = userCacheKey('profile', userId);
  const cached = getPersistentCache<Record<string, unknown>>(key, CACHE_VERSION);
  if (cached?.data) return cached.data;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) setPersistentCache(key, data, { ttlMs: CACHE_TTL.awards, version: CACHE_VERSION });
  return data;
}

/** Authoritative profile read for authentication/session hydration. Never cache this path. */
export async function getAuthenticatedProfileById(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(AUTH_PROFILE_FIELDS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getProfileByUsername(username: string) {
  const normalized = username.trim().replace(/^@/, '').toLowerCase();
  const key = `public.profile.${normalized}`;
  const cached = getPersistentCache<Record<string, unknown>>(key, CACHE_VERSION);
  if (cached?.data) return cached.data;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', normalized)
    .maybeSingle();

  if (error) throw error;
  if (data) setPersistentCache(key, data, { ttlMs: CACHE_TTL.publicHome, version: CACHE_VERSION });
  return data;
}

export async function updateProfile(userId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  removePersistentCache(userCacheKey('profile', userId));
  if (data?.username) removePersistentCache(`public.profile.${String(data.username).trim().replace(/^@/, '').toLowerCase()}`);
  return data;
}

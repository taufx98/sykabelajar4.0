import { supabase } from '@/lib/supabase';

const AUTH_PROFILE_FIELDS = 'id,username,full_name,account_type,bio,institution,grade,birth_date,subjects,avatar_url,cover_url,status,created_at,pembina,badge_showcase,badge_showcase_manual';

export async function getProfileById(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

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
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;
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
  return data;
}

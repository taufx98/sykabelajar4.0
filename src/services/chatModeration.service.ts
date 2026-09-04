import { supabase } from '@/lib/supabase';

export interface ChatAccessStatus {
  blocked: boolean;
  reason: string | null;
  blocked_by: string | null;
  strike_level: number | null;
  blocked_until: string | null;
  is_permanent: boolean;
}

export interface ChatModerationUser {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  chat_blocked: boolean;
}

export interface BlockedChatUser extends ChatModerationUser {
  user_id: string;
  blocked_at: string;
  blocked_by: string | null;
  reason: string | null;
  strike_level: number;
  blocked_until: string | null;
  is_permanent: boolean;
  currently_blocked: boolean;
}

export async function getChatAccessStatus(): Promise<ChatAccessStatus> {
  const { data, error } = await supabase.rpc('get_chat_access_status');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    blocked: Boolean(row.blocked),
    reason: row.reason == null ? null : String(row.reason),
    blocked_by: row.blocked_by == null ? null : String(row.blocked_by),
    strike_level: row.strike_level == null ? null : Number(row.strike_level),
    blocked_until: row.blocked_until == null ? null : String(row.blocked_until),
    is_permanent: Boolean(row.is_permanent),
  };
}

export async function adminSearchChatUsers(search = '', limit = 20): Promise<ChatModerationUser[]> {
  const { data, error } = await supabase.rpc('admin_search_chat_users', {
    p_search: search.trim() || null,
    p_limit: Math.min(Math.max(limit, 1), 50),
  });
  if (error) throw error;
  return (data ?? []) as ChatModerationUser[];
}

export async function adminGetBlockedChatUsers(search = '', limit = 50): Promise<BlockedChatUser[]> {
  const { data, error } = await supabase.rpc('admin_get_chat_user_moderation', {
    p_search: search.trim() || null,
    p_limit: Math.min(Math.max(limit, 1), 100),
  });
  if (error) throw error;
  return (data ?? []) as BlockedChatUser[];
}

export async function adminSetChatUserBlock(
  userId: string,
  blocked: boolean,
  reason = '',
  strikeLevel = 1,
  durationMinutes: number | null = null,
  permanent = false,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_chat_user_block', {
    p_user_id: userId,
    p_blocked: blocked,
    p_reason: reason.trim() || null,
    p_strike_level: strikeLevel,
    p_duration_minutes: durationMinutes,
    p_permanent: permanent,
  });
  if (error) throw error;
}

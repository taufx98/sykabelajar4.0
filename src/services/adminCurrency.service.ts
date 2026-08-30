import { supabase } from '@/lib/supabase';

export type CurrencyType = 'xp' | 'edu_coin';

export interface CurrencyAdjustmentLog {
  id: string;
  admin_id: string;
  target_user_id: string;
  target_username?: string;
  currency_type: CurrencyType;
  delta: number;
  reason: string;
  balance_before: number;
  balance_after: number;
  created_at: string;
}

export interface UserCurrencyInfo {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  institution: string | null;
  total_xp: number;
  edu_coin: number;
}

/**
 * Search users by name/username, returning XP & Coin balances.
 * Used in the admin currency management page user search.
 */
export async function searchUsersForCurrency(query: string, limit = 30): Promise<UserCurrencyInfo[]> {
  let queryBuilder = supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url, institution, total_xp, edu_coin');

  if (query.trim()) {
    const q = query.trim();
    queryBuilder = queryBuilder.or(
      `full_name.ilike.%${q}%,username.ilike.%${q}%`
    );
  }

  const { data, error } = await queryBuilder
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    username: row.username ?? '',
    full_name: row.full_name ?? '',
    avatar_url: row.avatar_url ?? null,
    institution: row.institution ?? null,
    total_xp: Number(row.total_xp ?? 0),
    edu_coin: Number(row.edu_coin ?? 0),
  }));
}

/**
 * Adjust a user's XP or edu_coin by a delta amount (positive = add, negative = subtract).
 * This calls the server-authoritative RPC function which enforces:
 *  - caller must be admin
 *  - balance cannot go negative
 *  - audit log is written
 */
export async function adjustUserCurrency(
  targetUserId: string,
  currencyType: CurrencyType,
  delta: number,
  reason: string,
): Promise<CurrencyAdjustmentLog> {
  const { data, error } = await supabase.rpc('admin_adjust_user_currency', {
    p_target_user_id: targetUserId,
    p_currency_type: currencyType,
    p_delta: delta,
    p_reason: reason,
  });

  if (error) throw error;
  return data as CurrencyAdjustmentLog;
}

/**
 * Fetch recent adjustment logs for a specific target user.
 */
export async function getUserCurrencyLogs(
  targetUserId: string,
  limit = 50,
): Promise<CurrencyAdjustmentLog[]> {
  const { data, error } = await supabase.rpc('get_user_currency_logs', {
    p_target_user_id: targetUserId,
    p_limit: limit,
  });

  if (error) throw error;
  return (data ?? []) as CurrencyAdjustmentLog[];
}

/**
 * Fetch all recent adjustment logs (admin overview).
 */
export async function getAllCurrencyLogs(limit = 100): Promise<CurrencyAdjustmentLog[]> {
  const { data, error } = await supabase.rpc('get_all_currency_logs', {
    p_limit: limit,
  });

  if (error) throw error;
  return (data ?? []) as CurrencyAdjustmentLog[];
}

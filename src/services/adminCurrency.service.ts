import { supabase } from '@/lib/supabase';

export type CurrencyType = 'xp' | 'edu_coin';

/** Filter criteria for bulk award user selection */
export interface BulkFilter {
  /** Filter type */
  type: 'all' | 'top_xp' | 'top_coin' | 'recently_active' | 'competition_participants' | 'certificate_holders';
  /** Max number of users (for top-N filters) */
  limit: number;
  /** Competition ID for competition_participants filter */
  competitionId?: string;
}

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

// ═══ BULK AWARD FUNCTIONS ═══

export interface BulkFilterResult {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  institution: string | null;
  total_xp: number;
  edu_coin: number;
  /** Extra stat based on filter type */
  stat_label?: string;
  stat_value?: number;
}

/** Fetch users based on filter criteria */
export async function fetchFilteredUsers(filter: BulkFilter): Promise<BulkFilterResult[]> {
  switch (filter.type) {
    case 'all': {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin')
        .order('created_at', { ascending: false })
        .limit(filter.limit);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...mapProfile(r), stat_label: 'Total XP', stat_value: Number(r.total_xp ?? 0) }));
    }
    case 'top_xp': {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin')
        .order('total_xp', { ascending: false })
        .limit(filter.limit);
      if (error) throw error;
      return (data ?? []).map((r: any, i: number) => ({ ...mapProfile(r), stat_label: `Rank XP #${i + 1}`, stat_value: Number(r.total_xp ?? 0) }));
    }
    case 'top_coin': {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin')
        .order('edu_coin', { ascending: false })
        .limit(filter.limit);
      if (error) throw error;
      return (data ?? []).map((r: any, i: number) => ({ ...mapProfile(r), stat_label: `Rank Coin #${i + 1}`, stat_value: Number(r.edu_coin ?? 0) }));
    }
    case 'recently_active': {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin,updated_at')
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(filter.limit);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...mapProfile(r), stat_label: 'Terakhir aktif', stat_value: 0 }));
    }
    case 'competition_participants': {
      if (!filter.competitionId) return [];
      const { data: regs, error: rErr } = await supabase
        .from('registrations')
        .select('user_id')
        .eq('competition_id', filter.competitionId)
        .in('status', ['APPROVED', 'PENDING']);
      if (rErr) throw rErr;
      const userIds = [...new Set((regs ?? []).map((r: any) => r.user_id))];
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin')
        .in('id', userIds.slice(0, filter.limit));
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...mapProfile(r), stat_label: 'Peserta lomba', stat_value: 1 }));
    }
    case 'certificate_holders': {
      const { data: certs, error: cErr } = await supabase
        .from('certificates')
        .select('user_id')
        .eq('status', 'PUBLISHED');
      if (cErr) throw cErr;
      const counts: Record<string, number> = {};
      for (const c of certs ?? []) counts[c.user_id] = (counts[c.user_id] ?? 0) + 1;
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, filter.limit);
      if (!sorted.length) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,institution,total_xp,edu_coin')
        .in('id', sorted.map(([id]) => id));
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...mapProfile(r), stat_label: 'Sertifikat', stat_value: counts[r.id] ?? 0 }));
    }
    default:
      return [];
  }
}

function mapProfile(r: any): BulkFilterResult {
  return {
    id: r.id,
    username: r.username ?? '',
    full_name: r.full_name ?? '',
    avatar_url: r.avatar_url ?? null,
    institution: r.institution ?? null,
    total_xp: Number(r.total_xp ?? 0),
    edu_coin: Number(r.edu_coin ?? 0),
  };
}

export interface BulkResult {
  success: number;
  failed: number;
  skipped: number;
  total: number;
  results: Array<{ user_id: string; username?: string; status: string; old?: number; new?: number; message?: string }>;
}

/** Execute bulk currency adjustment for multiple users */
export async function bulkAdjustCurrency(
  userIds: string[],
  currencyType: CurrencyType,
  delta: number,
  reason: string,
): Promise<BulkResult> {
  const { data, error } = await supabase.rpc('admin_bulk_adjust_currency', {
    p_user_ids: userIds,
    p_currency_type: currencyType,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) throw error;
  return data as BulkResult;
}

import { supabase } from '@/lib/supabase';

export interface PlatformStats {
  total_users: number;
  total_students: number;
  total_schools: number;
  total_competitions: number;
  total_public_competitions: number;
  total_certificates: number;
}

export interface PublicLeaderboardRow {
  user_id: string;
  username: string;
  display_name: string;
  institution: string | null;
  avatar_url: string | null;
  grade: string | null;
  xp: number;
  rank: number;
  rank_change: 'up' | 'same' | 'down';
  point_change: number;
}

export interface PublicCoinLeaderboardRow {
  user_id: string;
  username: string;
  display_name: string;
  institution: string | null;
  avatar_url: string | null;
  grade: string | null;
  edu_coin: number;
  rank: number;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const { data, error } = await supabase.rpc('get_platform_stats');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_users: Number(row?.total_users ?? 0),
    total_students: Number(row?.total_students ?? 0),
    total_schools: Number(row?.total_schools ?? 0),
    total_competitions: Number(row?.total_competitions ?? 0),
    total_public_competitions: Number(row?.total_public_competitions ?? 0),
    total_certificates: Number(row?.total_certificates ?? 0),
  };
}

export async function getPublicLeaderboard(limit = 100): Promise<PublicLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_public_leaderboard_v2', { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    user_id: String(row.user_id),
    username: String(row.username ?? ''),
    display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
    institution: row.institution == null ? null : String(row.institution),
    avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
    grade: row.grade == null ? null : String(row.grade),
    xp: Number(row.xp ?? 0),
    rank: Number(row.rank ?? 0),
    rank_change: (row.rank_change === 'up' || row.rank_change === 'down') ? row.rank_change : 'same',
    point_change: Number(row.point_change ?? 0),
  }));
}

export async function getPublicCoinLeaderboard(limit = 100): Promise<PublicCoinLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_public_coin_leaderboard_v2', { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    user_id: String(row.user_id),
    username: String(row.username ?? ''),
    display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
    institution: row.institution == null ? null : String(row.institution),
    avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
    grade: row.grade == null ? null : String(row.grade),
    edu_coin: Number(row.edu_coin ?? 0),
    rank: Number(row.rank ?? 0),
  }));
}

export async function getPublicCompetitions(limit = 6) {
  const { data, error } = await supabase.rpc('get_public_competitions');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).slice(0, limit);
}

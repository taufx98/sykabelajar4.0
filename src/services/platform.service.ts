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

const CACHE_PREFIX = 'syka.public.v1.';
const CACHE_TTL = {
  stats: 60_000,
  leaderboard: 60_000,
  coinLeaderboard: 60_000,
  competitions: 90_000,
} as const;
const COMPETITIONS_CACHE_LIMIT = 100;

function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; data: T };
    if (!parsed || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T, ttl: number) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ expiresAt: Date.now() + ttl, data }));
  } catch {
    // Storage may be unavailable or full; network fallback remains authoritative.
  }
}

let statsMemory: { expiresAt: number; data: PlatformStats } | null = null;
const leaderboardMemory = new Map<number, { expiresAt: number; data: PublicLeaderboardRow[] }>();
const coinLeaderboardMemory = new Map<number, { expiresAt: number; data: PublicCoinLeaderboardRow[] }>();
let competitionsMemory: { expiresAt: number; data: Array<Record<string, unknown>> } | null = null;
let competitionsInFlight: Promise<Array<Record<string, unknown>>> | null = null;

export async function getPlatformStats(): Promise<PlatformStats> {
  if (statsMemory && statsMemory.expiresAt > Date.now()) return statsMemory.data;
  const cached = readCache<PlatformStats>('stats');
  if (cached) {
    statsMemory = { expiresAt: Date.now() + CACHE_TTL.stats, data: cached };
    return cached;
  }
  const { data, error } = await supabase.rpc('get_platform_stats');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const result = {
    total_users: Number(row?.total_users ?? 0),
    total_students: Number(row?.total_students ?? 0),
    total_schools: Number(row?.total_schools ?? 0),
    total_competitions: Number(row?.total_competitions ?? 0),
    total_public_competitions: Number(row?.total_public_competitions ?? 0),
    total_certificates: Number(row?.total_certificates ?? 0),
  };
  statsMemory = { expiresAt: Date.now() + CACHE_TTL.stats, data: result };
  writeCache('stats', result, CACHE_TTL.stats);
  return result;
}

export async function getPublicLeaderboard(limit = 100): Promise<PublicLeaderboardRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const memory = leaderboardMemory.get(safeLimit);
  if (memory && memory.expiresAt > Date.now()) return memory.data;
  const cached = readCache<PublicLeaderboardRow[]>(`leaderboard.${safeLimit}`);
  if (cached) {
    leaderboardMemory.set(safeLimit, { expiresAt: Date.now() + CACHE_TTL.leaderboard, data: cached });
    return cached;
  }
  const { data, error } = await supabase.rpc('get_public_leaderboard_v2', { p_limit: safeLimit });
  if (error) throw error;
  const result = (data ?? []).map((row: Record<string, unknown>) => ({
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
  leaderboardMemory.set(safeLimit, { expiresAt: Date.now() + CACHE_TTL.leaderboard, data: result });
  writeCache(`leaderboard.${safeLimit}`, result, CACHE_TTL.leaderboard);
  return result;
}

export async function getPublicCoinLeaderboard(limit = 100): Promise<PublicCoinLeaderboardRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const memory = coinLeaderboardMemory.get(safeLimit);
  if (memory && memory.expiresAt > Date.now()) return memory.data;
  const cached = readCache<PublicCoinLeaderboardRow[]>(`coinLeaderboard.${safeLimit}`);
  if (cached) {
    coinLeaderboardMemory.set(safeLimit, { expiresAt: Date.now() + CACHE_TTL.coinLeaderboard, data: cached });
    return cached;
  }
  const { data, error } = await supabase.rpc('get_public_coin_leaderboard_v2', { p_limit: safeLimit });
  if (error) throw error;
  const result = (data ?? []).map((row: Record<string, unknown>) => ({
    user_id: String(row.user_id),
    username: String(row.username ?? ''),
    display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
    institution: row.institution == null ? null : String(row.institution),
    avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
    grade: row.grade == null ? null : String(row.grade),
    edu_coin: Number(row.edu_coin ?? 0),
    rank: Number(row.rank ?? 0),
  }));
  coinLeaderboardMemory.set(safeLimit, { expiresAt: Date.now() + CACHE_TTL.coinLeaderboard, data: result });
  writeCache(`coinLeaderboard.${safeLimit}`, result, CACHE_TTL.coinLeaderboard);
  return result;
}

export async function getPublicCompetitions(limit = 6) {
  const safeLimit = Math.max(1, Math.min(limit, COMPETITIONS_CACHE_LIMIT));
  const now = Date.now();
  if (competitionsMemory && competitionsMemory.expiresAt > now) {
    return competitionsMemory.data.slice(0, safeLimit);
  }
  const cached = readCache<Array<Record<string, unknown>>>(`competitions.${COMPETITIONS_CACHE_LIMIT}`);
  if (cached) {
    competitionsMemory = { expiresAt: now + CACHE_TTL.competitions, data: cached };
    return cached.slice(0, safeLimit);
  }
  if (competitionsInFlight) {
    const rows = await competitionsInFlight;
    return rows.slice(0, safeLimit);
  }
  competitionsInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_public_competitions');
    if (error) throw error;
    const result = ((data ?? []) as Array<Record<string, unknown>>).slice(0, COMPETITIONS_CACHE_LIMIT);
    competitionsMemory = { expiresAt: Date.now() + CACHE_TTL.competitions, data: result };
    writeCache(`competitions.${COMPETITIONS_CACHE_LIMIT}`, result, CACHE_TTL.competitions);
    return result;
  })();
  try {
    const rows = await competitionsInFlight;
    return rows.slice(0, safeLimit);
  } finally {
    competitionsInFlight = null;
  }
}

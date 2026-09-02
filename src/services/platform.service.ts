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

export interface HomeSnapshot {
  competitions: Array<Record<string, unknown>>;
  leaderboard: PublicLeaderboardRow[];
  coin_leaderboard: PublicCoinLeaderboardRow[];
  stats: PlatformStats;
  feed: Array<Record<string, unknown>>;
}

const CACHE_PREFIX = 'syka.public.v3.';
const CACHE_TTL = {
  stats: 15 * 60_000,
  leaderboard: 15 * 60_000,
  coinLeaderboard: 30 * 60_000,
  competitions: 30 * 60_000,
  home: 15 * 60_000,
} as const;
const NEGATIVE_CACHE_TTL = 10 * 60_000;
const COMPETITIONS_CACHE_LIMIT = 20;

function readCache<T>(key: string): T | null {
  try {
    const storage = localStorage;
    const raw = storage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; data: T };
    if (!parsed || parsed.expiresAt <= Date.now()) {
      storage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T, ttl: number) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ expiresAt: Date.now() + ttl, data }));
  } catch {
    // Local storage is optional and may be unavailable or full.
  }
}

const emptyStats = (): PlatformStats => ({
  total_users: 0,
  total_students: 0,
  total_schools: 0,
  total_competitions: 0,
  total_public_competitions: 0,
  total_certificates: 0,
});

const emptyHomeSnapshot = (): HomeSnapshot => ({
  competitions: [],
  leaderboard: [],
  coin_leaderboard: [],
  stats: emptyStats(),
  feed: [],
});

let statsMemory: { expiresAt: number; data: PlatformStats } | null = null;
const leaderboardMemory = new Map<number, { expiresAt: number; data: PublicLeaderboardRow[] }>();
const coinLeaderboardMemory = new Map<number, { expiresAt: number; data: PublicCoinLeaderboardRow[] }>();
let competitionsMemory: { expiresAt: number; data: Array<Record<string, unknown>> } | null = null;
let homeMemory: { expiresAt: number; data: HomeSnapshot } | null = null;
let statsInFlight: Promise<PlatformStats> | null = null;
let leaderboardInFlight: Promise<PublicLeaderboardRow[]> | null = null;
let coinLeaderboardInFlight: Promise<PublicCoinLeaderboardRow[]> | null = null;
let competitionsInFlight: Promise<Array<Record<string, unknown>>> | null = null;
let homeInFlight: Promise<HomeSnapshot> | null = null;
let statsFailureUntil = 0;
let leaderboardFailureUntil = 0;
let coinLeaderboardFailureUntil = 0;
let competitionsFailureUntil = 0;
let homeFailureUntil = 0;

export async function getHomeSnapshot(feedLimit = 15): Promise<HomeSnapshot> {
  const safeFeedLimit = Math.max(1, Math.min(feedLimit + 1, 16));
  const now = Date.now();
  if (homeMemory && homeMemory.expiresAt > now && homeMemory.data.feed.length >= Math.min(feedLimit, 15)) {
    return homeMemory.data;
  }
  const cached = readCache<HomeSnapshot>('home');
  if (cached && cached.feed.length >= Math.min(feedLimit, 15)) {
    homeMemory = { expiresAt: now + CACHE_TTL.home, data: cached };
    return cached;
  }
  if (homeFailureUntil > now) return emptyHomeSnapshot();
  if (homeInFlight) return homeInFlight;

  homeInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_home_snapshot_v1', { p_feed_limit: safeFeedLimit });
    if (error) {
      homeFailureUntil = Date.now() + NEGATIVE_CACHE_TTL;
      throw error;
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const result: HomeSnapshot = {
      competitions: Array.isArray(payload.competitions) ? payload.competitions as Array<Record<string, unknown>> : [],
      leaderboard: Array.isArray(payload.leaderboard) ? (payload.leaderboard as Array<Record<string, unknown>>).map((row) => ({
        user_id: String(row.user_id),
        username: String(row.username ?? ''),
        display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
        institution: row.institution == null ? null : String(row.institution),
        avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
        grade: row.grade == null ? null : String(row.grade),
        xp: Number(row.xp ?? 0),
        rank: Number(row.rank ?? 0),
        rank_change: row.rank_change === 'up' || row.rank_change === 'down' ? row.rank_change : 'same',
        point_change: Number(row.point_change ?? 0),
      })) : [],
      coin_leaderboard: Array.isArray(payload.coin_leaderboard) ? (payload.coin_leaderboard as Array<Record<string, unknown>>).map((row) => ({
        user_id: String(row.user_id),
        username: String(row.username ?? ''),
        display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
        institution: row.institution == null ? null : String(row.institution),
        avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
        grade: row.grade == null ? null : String(row.grade),
        edu_coin: Number(row.edu_coin ?? 0),
        rank: Number(row.rank ?? 0),
      })) : [],
      stats: (() => {
        const row = (payload.stats ?? {}) as Record<string, unknown>;
        return {
          total_users: Number(row.total_users ?? 0),
          total_students: Number(row.total_students ?? 0),
          total_schools: Number(row.total_schools ?? 0),
          total_competitions: Number(row.total_competitions ?? 0),
          total_public_competitions: Number(row.total_public_competitions ?? 0),
          total_certificates: Number(row.total_certificates ?? 0),
        };
      })(),
      feed: Array.isArray(payload.feed) ? payload.feed as Array<Record<string, unknown>> : [],
    };
    homeMemory = { expiresAt: Date.now() + CACHE_TTL.home, data: result };
    homeFailureUntil = 0;
    writeCache('home', result, CACHE_TTL.home);
    return result;
  })();
  try {
    return await homeInFlight;
  } catch {
    return emptyHomeSnapshot();
  } finally {
    homeInFlight = null;
  }
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const now = Date.now();
  if (statsMemory && statsMemory.expiresAt > now) return statsMemory.data;
  const cached = readCache<PlatformStats>('stats');
  if (cached) {
    statsMemory = { expiresAt: now + CACHE_TTL.stats, data: cached };
    return cached;
  }
  if (statsFailureUntil > now) return emptyStats();
  if (statsInFlight) return statsInFlight;

  statsInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_platform_stats');
    if (error) {
      statsFailureUntil = Date.now() + NEGATIVE_CACHE_TTL;
      throw error;
    }
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
    statsFailureUntil = 0;
    writeCache('stats', result, CACHE_TTL.stats);
    return result;
  })();
  try {
    return await statsInFlight;
  } catch {
    return emptyStats();
  } finally {
    statsInFlight = null;
  }
}

export async function getPublicLeaderboard(limit = 100): Promise<PublicLeaderboardRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const now = Date.now();
  const memory = leaderboardMemory.get(safeLimit);
  if (memory && memory.expiresAt > now) return memory.data;
  const cached = readCache<PublicLeaderboardRow[]>(`leaderboard.${safeLimit}`);
  if (cached) {
    leaderboardMemory.set(safeLimit, { expiresAt: now + CACHE_TTL.leaderboard, data: cached });
    return cached;
  }
  if (leaderboardFailureUntil > now) return [];
  if (leaderboardInFlight) {
    const rows = await leaderboardInFlight.catch(() => []);
    return rows.slice(0, safeLimit);
  }

  leaderboardInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_public_leaderboard_v2', { p_limit: safeLimit });
    if (error) {
      leaderboardFailureUntil = Date.now() + NEGATIVE_CACHE_TTL;
      throw error;
    }
    const result = (data ?? []).map((row: Record<string, unknown>) => ({
      user_id: String(row.user_id),
      username: String(row.username ?? ''),
      display_name: String(row.display_name ?? row.username ?? 'Pengguna'),
      institution: row.institution == null ? null : String(row.institution),
      avatar_url: row.avatar_url == null ? null : String(row.avatar_url),
      grade: row.grade == null ? null : String(row.grade),
      xp: Number(row.xp ?? 0),
      rank: Number(row.rank ?? 0),
      rank_change: row.rank_change === 'up' || row.rank_change === 'down' ? row.rank_change : 'same',
      point_change: Number(row.point_change ?? 0),
    }));
    leaderboardMemory.set(safeLimit, { expiresAt: Date.now() + CACHE_TTL.leaderboard, data: result });
    leaderboardFailureUntil = 0;
    writeCache(`leaderboard.${safeLimit}`, result, CACHE_TTL.leaderboard);
    return result;
  })();
  try {
    return await leaderboardInFlight;
  } catch {
    return [];
  } finally {
    leaderboardInFlight = null;
  }
}

export async function getPublicCoinLeaderboard(limit = 100): Promise<PublicCoinLeaderboardRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const now = Date.now();
  const memory = coinLeaderboardMemory.get(safeLimit);
  if (memory && memory.expiresAt > now) return memory.data;
  const cached = readCache<PublicCoinLeaderboardRow[]>(`coinLeaderboard.${safeLimit}`);
  if (cached) {
    coinLeaderboardMemory.set(safeLimit, { expiresAt: now + CACHE_TTL.coinLeaderboard, data: cached });
    return cached;
  }
  if (coinLeaderboardFailureUntil > now) return [];
  if (coinLeaderboardInFlight) {
    const rows = await coinLeaderboardInFlight.catch(() => []);
    return rows.slice(0, safeLimit);
  }

  coinLeaderboardInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_public_coin_leaderboard_v2', { p_limit: safeLimit });
    if (error) {
      coinLeaderboardFailureUntil = Date.now() + NEGATIVE_CACHE_TTL;
      throw error;
    }
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
    coinLeaderboardFailureUntil = 0;
    writeCache(`coinLeaderboard.${safeLimit}`, result, CACHE_TTL.coinLeaderboard);
    return result;
  })();
  try {
    return await coinLeaderboardInFlight;
  } catch {
    return [];
  } finally {
    coinLeaderboardInFlight = null;
  }
}

export async function getPublicCompetitions(limit = 6): Promise<Array<Record<string, unknown>>> {
  const safeLimit = Math.max(1, Math.min(limit, COMPETITIONS_CACHE_LIMIT));
  const now = Date.now();
  if (competitionsMemory && competitionsMemory.expiresAt > now) return competitionsMemory.data.slice(0, safeLimit);
  const cached = readCache<Array<Record<string, unknown>>>('competitions');
  if (cached) {
    competitionsMemory = { expiresAt: now + CACHE_TTL.competitions, data: cached };
    return cached.slice(0, safeLimit);
  }
  if (competitionsFailureUntil > now) return [];
  if (competitionsInFlight) {
    const rows = await competitionsInFlight.catch(() => []);
    return rows.slice(0, safeLimit);
  }

  competitionsInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_public_competitions_v2', { p_limit: COMPETITIONS_CACHE_LIMIT });
    if (error) {
      competitionsFailureUntil = Date.now() + NEGATIVE_CACHE_TTL;
      throw error;
    }
    const result = ((data ?? []) as Array<Record<string, unknown>>).slice(0, COMPETITIONS_CACHE_LIMIT);
    competitionsMemory = { expiresAt: Date.now() + CACHE_TTL.competitions, data: result };
    competitionsFailureUntil = 0;
    writeCache('competitions', result, CACHE_TTL.competitions);
    return result;
  })();
  try {
    const rows = await competitionsInFlight;
    return rows.slice(0, safeLimit);
  } catch {
    return [];
  } finally {
    competitionsInFlight = null;
  }
}

import { getPersistentCache, removePersistentCache } from '@/lib/persistentCache';

const LEGACY_PUBLIC_PREFIX = 'syka.public.v4.';
const SHARED_PUBLIC_LIMITS = [6, 10, 20, 50, 100];

export const CACHE_TTL = {
  publicHome: 15 * 60_000,
  publicLeaderboard: 15 * 60_000,
  publicCoinLeaderboard: 30 * 60_000,
  publicCompetitions: 30 * 60_000,
  publicStats: 15 * 60_000,
  feed: 5 * 60_000,
  notifications: 10 * 60_000,
  awards: 30 * 60_000,
  certificates: 30 * 60_000,
  orders: 10 * 60_000,
  dailyTasks: 15 * 60_000,
  printCatalog: 60 * 60_000,
} as const;

export const CACHE_VERSION = 'runtime-v3';

export const userCacheKey = (resource: string, userId: string) => `user.${userId}.${resource}`;

export function clearUserCache(userId: string, resources?: string[]): void {
  const names = resources ?? ['notifications', 'awards', 'certificates', 'orders', 'chat.unread'];
  for (const resource of names) removePersistentCache(userCacheKey(resource, userId));
}

export function clearPublicCache(resources?: Array<'home' | 'stats' | 'leaderboard' | 'coinLeaderboard' | 'competitions' | 'feed'>): void {
  const names = resources ?? ['home', 'stats', 'leaderboard', 'coinLeaderboard', 'competitions', 'feed'];
  for (const name of names) {
    removePersistentCache(`public.${name}`);
    if (name === 'leaderboard') for (const limit of SHARED_PUBLIC_LIMITS) removePersistentCache(`public.leaderboard.${limit}`);
    if (name === 'coinLeaderboard') for (const limit of SHARED_PUBLIC_LIMITS) removePersistentCache(`public.coinLeaderboard.${limit}`);
    try {
      localStorage.removeItem(LEGACY_PUBLIC_PREFIX + name);
      if (name === 'leaderboard') for (const limit of [10, 20, 50, 100]) localStorage.removeItem(`${LEGACY_PUBLIC_PREFIX}leaderboard.${limit}`);
      if (name === 'coinLeaderboard') for (const limit of [10, 20, 50, 100]) localStorage.removeItem(`${LEGACY_PUBLIC_PREFIX}coinLeaderboard.${limit}`);
    } catch {
      // Cache invalidation must never break the application.
    }
  }
}

export function hasCachedValue<T>(key: string): boolean {
  return getPersistentCache<T>(key, CACHE_VERSION) !== null;
}

export function invalidateForRealtime(resource: string, userId?: string): void {
  switch (resource) {
    case 'competition': clearPublicCache(['home', 'stats', 'competitions']); return;
    case 'leaderboard': clearPublicCache(['home', 'leaderboard', 'coinLeaderboard']); return;
    case 'feed': clearPublicCache(['home', 'feed']); return;
    case 'banner': clearPublicCache(['home']); return;
    case 'profile': clearPublicCache(['home', 'leaderboard', 'coinLeaderboard']); if (userId) clearUserCache(userId, ['profile']); return;
    case 'notification': if (userId) clearUserCache(userId, ['notifications']); return;
    case 'order': if (userId) clearUserCache(userId, ['orders']); return;
    case 'award': if (userId) clearUserCache(userId, ['awards', 'certificates']); return;
    default: return;
  }
}

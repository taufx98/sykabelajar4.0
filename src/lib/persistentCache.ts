const PREFIX = 'syka.cache.v1.';

// Keep stale data available for one additional original TTL while a
// stale-while-revalidate request runs. After that grace period it is discarded.
const MAX_STALE_GRACE_MULTIPLIER = 1;

export interface CacheEnvelope<T> {
  data: T;
  savedAt: number;
  expiresAt: number;
  version?: string | number | null;
}

export interface CacheOptions {
  ttlMs: number;
  version?: string | number | null;
}

/**
 * Read a cache entry while it is fresh or inside its bounded stale grace period.
 * Stale-aware consumers can render the stale value while revalidating it.
 */
export function getPersistentCache<T>(key: string, version?: string | number | null): CacheEnvelope<T> | null {
  try {
    const storageKey = PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      !envelope ||
      !Number.isFinite(envelope.savedAt) ||
      !Number.isFinite(envelope.expiresAt) ||
      envelope.savedAt < 0 ||
      envelope.expiresAt <= envelope.savedAt ||
      !Object.prototype.hasOwnProperty.call(envelope, 'data')
    ) {
      localStorage.removeItem(storageKey);
      return null;
    }
    if (version != null && envelope.version !== version) {
      localStorage.removeItem(storageKey);
      return null;
    }

    const originalTtl = envelope.expiresAt - envelope.savedAt;
    const staleDeadline = envelope.expiresAt + originalTtl * MAX_STALE_GRACE_MULTIPLIER;
    if (Date.now() >= staleDeadline) {
      localStorage.removeItem(storageKey);
      return null;
    }

    return envelope;
  } catch {
    return null;
  }
}

/** Read only cache entries whose original TTL has not expired. */
export function getFreshPersistentCache<T>(key: string, version?: string | number | null): CacheEnvelope<T> | null {
  const envelope = getPersistentCache<T>(key, version);
  if (!envelope || envelope.expiresAt <= Date.now()) return null;
  return envelope;
}

export function getPersistentCacheState<T>(key: string, version?: string | number | null): {
  envelope: CacheEnvelope<T>;
  fresh: boolean;
  stale: boolean;
} | null {
  const envelope = getPersistentCache<T>(key, version);
  if (!envelope) return null;
  const fresh = envelope.expiresAt > Date.now();
  return { envelope, fresh, stale: !fresh };
}

export function setPersistentCache<T>(key: string, data: T, options: CacheOptions): CacheEnvelope<T> {
  const now = Date.now();
  const envelope: CacheEnvelope<T> = {
    data,
    savedAt: now,
    expiresAt: now + Math.max(1_000, options.ttlMs),
    version: options.version ?? null,
  };
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch {
    // Cache is optional. The application remains fully backend-driven when storage is unavailable.
  }
  return envelope;
}

export function removePersistentCache(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore storage failures.
  }
}

export function clearPersistentCache(prefix = ''): void {
  try {
    const fullPrefix = PREFIX + prefix;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(fullPrefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures.
  }
}

export function patchPersistentCache<T>(
  key: string,
  updater: (current: T | null) => T | null,
  options: CacheOptions,
): CacheEnvelope<T> | null {
  const current = getPersistentCache<T>(key, options.version)?.data ?? null;
  const next = updater(current);
  if (next === null) {
    removePersistentCache(key);
    return null;
  }
  return setPersistentCache(key, next, options);
}

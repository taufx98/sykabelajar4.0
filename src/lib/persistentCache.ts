const PREFIX = 'syka.cache.v1.';

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

export function getPersistentCache<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (!envelope || typeof envelope.savedAt !== 'number' || typeof envelope.expiresAt !== 'number') {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    if (envelope.expiresAt <= Date.now()) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
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

export function patchPersistentCache<T>(
  key: string,
  updater: (current: T | null) => T | null,
  options: CacheOptions,
): CacheEnvelope<T> | null {
  const current = getPersistentCache<T>(key)?.data ?? null;
  const next = updater(current);
  if (next === null) {
    removePersistentCache(key);
    return null;
  }
  return setPersistentCache(key, next, options);
}

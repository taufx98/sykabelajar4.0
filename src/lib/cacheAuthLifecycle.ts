import { clearUserCache } from '@/lib/cacheRegistry';
import { subscribeAuthSessionEvents } from '@/services/authSessionEvents.mjs';

let started = false;
let previousUserId: string | null = null;

/**
 * Clears user-scoped UI cache when the authenticated identity changes or signs out.
 * The session identity is published by AppContext; this module never creates
 * its own provider listener and never treats cache state as authentication.
 */
export function startCacheAuthLifecycle(): () => void {
  if (started) return () => undefined;
  started = true;

  const unsubscribe = subscribeAuthSessionEvents((event) => {
    const previous = event.previousUserId ?? previousUserId;

    if (event.type === 'SIGNED_OUT') {
      if (previous) clearUserCache(previous);
      previousUserId = null;
      return;
    }

    if (previous && previous !== event.userId) {
      clearUserCache(previous);
    }

    previousUserId = event.userId;
  });

  return () => {
    unsubscribe();
    started = false;
    previousUserId = null;
  };
}

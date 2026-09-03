import { supabase } from '@/lib/supabase';
import { clearUserCache } from '@/lib/cacheRegistry';

let started = false;
let previousUserId: string | null = null;

/**
 * Clears user-scoped UI cache when the authenticated identity changes or signs out.
 * Cache is presentation-only; auth/session state remains authoritative in Supabase Auth.
 */
export function startCacheAuthLifecycle(): () => void {
  if (started) return () => undefined;
  started = true;

  const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id ?? null;

    if (previousUserId && previousUserId !== nextUserId) {
      clearUserCache(previousUserId);
    }

    if (event === 'SIGNED_OUT') {
      if (previousUserId) clearUserCache(previousUserId);
      previousUserId = null;
      return;
    }

    previousUserId = nextUserId;
  });

  return () => {
    subscription.subscription.unsubscribe();
    started = false;
    previousUserId = null;
  };
}

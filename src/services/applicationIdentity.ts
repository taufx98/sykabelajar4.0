import { supabase } from '@/lib/supabase';
import { getAuthSessionSnapshot } from '@/services/authSessionEvents.mjs';
import { createApplicationIdentityReader } from '@/services/applicationIdentityReader.mjs';

const readApplicationIdentity = createApplicationIdentityReader({
  getSnapshot: getAuthSessionSnapshot,
  getFallbackUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user?.id ?? null;
  },
});

/**
 * Resolves the current application UUID from the shared session snapshot.
 * Only falls back to the active auth provider before the event bus bootstrap.
 */
export function getCurrentApplicationUserId(): Promise<string | null> {
  return readApplicationIdentity();
}

export async function requireCurrentApplicationUserId(
  message = 'AUTH_REQUIRED',
): Promise<string> {
  const userId = await getCurrentApplicationUserId();
  if (!userId) throw new Error(message);
  return userId;
}

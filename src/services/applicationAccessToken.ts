import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import {
  getStagingBetterAuthClient,
  isBetterAuthFrontendEnabledForSupabase,
} from '@/services/betterAuthApi.client';

/**
 * Returns the short-lived bearer token used for Supabase resource APIs.
 *
 * Supabase Auth remains the live provider by default. The Better Auth branch is
 * available only behind the explicit staging flag and obtains an audience-
 * restricted OAuth PKCE resource JWT from the Cloudflare Worker. No token is
 * written to browser storage or copied into shared session events.
 */
export async function getSupabaseResourceAccessToken(): Promise<string | null> {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    return getStagingBetterAuthClient().getSupabaseAccessToken();
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

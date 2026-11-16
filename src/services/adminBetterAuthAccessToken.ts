import { getStagingBetterAuthClient } from '@/services/betterAuthApi.client';

const STAGING_APP_HOST = 'staging.sykabelajar.my.id';

/**
 * Admin configuration APIs on staging accept Better Auth resource JWTs only.
 * Do not fall back to Supabase Auth sessions here: the isolated staging
 * Supabase project has no legacy Auth identities to authenticate these calls.
 * The custom same-site staging hostname is required so the Worker's Lax
 * session cookie is available during the resource-token flow.
 */
export async function getStagingAdminAccessToken(): Promise<string> {
  if (typeof window === 'undefined' || window.location.hostname.toLowerCase() !== STAGING_APP_HOST) {
    throw new Error('AUTH_STAGING_APP_ORIGIN_REQUIRED');
  }

  const token = await getStagingBetterAuthClient().getSupabaseAccessToken();
  if (!token) throw new Error('AUTH_SESSION_REQUIRED');
  return token;
}

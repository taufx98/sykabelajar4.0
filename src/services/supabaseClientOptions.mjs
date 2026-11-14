/**
 * Keep Supabase's built-in Auth client intact until the explicit Better Auth
 * staging switch is enabled. When enabled, all Supabase resource APIs use the
 * short-lived third-party JWT returned by the single Better Auth token broker.
 *
 * @param {{
 *   useExternalAuth: boolean,
 *   getExternalAccessToken?: () => Promise<string | null>,
 *   fetchImpl: typeof fetch
 * }} input
 */
export function createSupabaseClientOptions(input) {
  if (!input || typeof input !== "object" || typeof input.fetchImpl !== "function") {
    throw new TypeError("SUPABASE_CLIENT_OPTIONS_INVALID");
  }

  const options = {
    auth: input.useExternalAuth
      ? {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        }
      : {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
    global: { fetch: input.fetchImpl },
  };

  if (input.useExternalAuth) {
    if (typeof input.getExternalAccessToken !== "function") {
      throw new TypeError("SUPABASE_EXTERNAL_ACCESS_TOKEN_PROVIDER_REQUIRED");
    }
    return {
      ...options,
      accessToken: input.getExternalAccessToken,
    };
  }

  return options;
}

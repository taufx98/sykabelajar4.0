export const STAGING_BETTER_AUTH_SUPABASE_URL =
  "https://ydamszdfsxqisanazdkb.supabase.co";
export const BETTER_AUTH_ISSUER =
  "https://auth.sykabelajar.my.id/api/auth";
export const BETTER_AUTH_RESOURCE_AUDIENCE =
  "https://sykabelajar.my.id";

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

/**
 * Keep Production on Supabase Auth by default. Only the exact isolated staging
 * Supabase project auto-selects Better Auth when no explicit mode is set.
 * An explicit server-side mode remains available for a later approved cutover.
 */
export function resolveApplicationIdentityMode({ configuredMode, supabaseUrl } = {}) {
  const configured = typeof configuredMode === "string" ? configuredMode.trim() : "";
  if (configured) {
    return configured === "supabase" || configured === "better-auth"
      ? configured
      : "invalid";
  }
  return normalizeUrl(supabaseUrl) === STAGING_BETTER_AUTH_SUPABASE_URL
    ? "better-auth"
    : "supabase";
}

/**
 * Supply hard-pinned Better Auth verification values without requiring manual
 * Edge environment variables on the one isolated staging project. Production
 * and unknown project URLs still require explicit server-side configuration.
 */
export function resolveBetterAuthVerifierConfig({ supabaseUrl, issuer, audience } = {}) {
  const stagingDefaults =
    normalizeUrl(supabaseUrl) === STAGING_BETTER_AUTH_SUPABASE_URL;
  return {
    issuer: typeof issuer === "string" && issuer.trim()
      ? issuer.trim()
      : stagingDefaults ? BETTER_AUTH_ISSUER : "",
    audience: typeof audience === "string" && audience.trim()
      ? audience.trim()
      : stagingDefaults ? BETTER_AUTH_RESOURCE_AUDIENCE : "",
  };
}

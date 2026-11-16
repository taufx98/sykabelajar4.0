const BETTER_AUTH_STAGING_HOST = "staging.sykabelajar.my.id";
const BETTER_AUTH_STAGING_SUPABASE_ORIGIN = "https://ydamszdfsxqisanazdkb.supabase.co";

function requiredValue(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("[SykaBelajar] Missing required environment variable: " + name);
  }
  return value.trim();
}

function validatedSupabaseUrl(value, name, expectedOrigin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("[SykaBelajar] Invalid Supabase URL in " + name);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (expectedOrigin && url.origin !== expectedOrigin)
  ) {
    throw new Error("[SykaBelajar] Supabase URL is not allowed for this runtime: " + name);
  }
  return url.origin;
}

/**
 * Select the application data project at runtime.
 * Only the exact Better Auth staging hostname may use the staging Supabase
 * endpoint. All other previews and production preserve their existing env.
 */
export function resolveSupabaseEnvironment(hostname, environment) {
  const isBetterAuthStaging =
    typeof hostname === "string" &&
    hostname.trim().toLowerCase() === BETTER_AUTH_STAGING_HOST;

  const urlName = isBetterAuthStaging
    ? "VITE_BETTER_AUTH_SUPABASE_URL"
    : "VITE_SUPABASE_URL";
  const keyName = isBetterAuthStaging
    ? "VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY"
    : "VITE_SUPABASE_PUBLISHABLE_KEY";

  const supabaseUrl = validatedSupabaseUrl(
    requiredValue(environment, urlName),
    urlName,
    isBetterAuthStaging ? BETTER_AUTH_STAGING_SUPABASE_ORIGIN : undefined,
  );
  const supabasePublishableKey = requiredValue(environment, keyName);

  if (
    isBetterAuthStaging &&
    !supabasePublishableKey.startsWith("sb_publishable_")
  ) {
    throw new Error("[SykaBelajar] Better Auth staging requires a modern Supabase publishable key.");
  }

  return { supabaseUrl, supabasePublishableKey, isBetterAuthStaging };
}

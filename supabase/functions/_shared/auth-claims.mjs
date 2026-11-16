const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCESS_TOKEN_SECONDS = 300;

/**
 * Validate identity and resource claims already verified cryptographically by
 * Supabase's createSupabaseContext()/withSupabase wrapper.
 *
 * This function does NOT decode or verify a JWT. Never call it with unverified
 * request data; pass only ctx.jwtClaims from @supabase/server.
 */
export function validateBetterAuthClaims(claims, options) {
  const { issuer, audience, nowSeconds = Math.floor(Date.now() / 1000) } = options ?? {};
  if (!issuer || !audience) return { ok: false, reason: "AUTH_EXPECTED_ISSUER_OR_AUDIENCE_MISSING" };
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return { ok: false, reason: "AUTH_VERIFIED_CLAIMS_MISSING" };
  }

  if (claims.iss !== issuer) return { ok: false, reason: "AUTH_ISSUER_MISMATCH" };
  if (typeof claims.sub !== "string" || !UUID_PATTERN.test(claims.sub)) {
    return { ok: false, reason: "AUTH_SUBJECT_NOT_UUID" };
  }
  if (claims.role !== "authenticated") return { ok: false, reason: "AUTH_POSTGRES_ROLE_INVALID" };

  const audiences = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")
      ? claims.aud
      : [];
  if (!audiences.includes(audience)) return { ok: false, reason: "AUTH_AUDIENCE_MISMATCH" };

  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    return { ok: false, reason: "AUTH_TOKEN_TIME_CLAIMS_INVALID" };
  }
  if (claims.iat > nowSeconds + 30) return { ok: false, reason: "AUTH_TOKEN_ISSUED_IN_FUTURE" };
  if (claims.exp <= nowSeconds) return { ok: false, reason: "AUTH_TOKEN_EXPIRED" };
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_ACCESS_TOKEN_SECONDS) {
    return { ok: false, reason: "AUTH_TOKEN_LIFETIME_INVALID" };
  }

  return {
    ok: true,
    userId: claims.sub,
    issuer: claims.iss,
    audience,
    expiresAt: claims.exp,
  };
}

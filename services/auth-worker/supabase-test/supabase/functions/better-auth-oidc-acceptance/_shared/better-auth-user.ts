import { createSupabaseContext } from "npm:@supabase/server@1.9.2";
import { validateBetterAuthClaims } from "./auth-claims.mjs";
import { resolveBetterAuthVerifierConfig } from "./resolve-application-identity-mode.mjs";

const EXPECTED_BETTER_AUTH_ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const EXPECTED_RESOURCE_AUDIENCE = "https://sykabelajar.my.id";

// JWTs in compact JWS form must contain exactly three non-empty base64url
// segments. Reject obvious malformed credentials before invoking the SDK;
// network/JWKS failures remain distinguishable as service errors.
const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/;

/**
 * Authenticate a Better Auth access token through Supabase's supported
 * third-party JWT verifier. The verifier must use Better Auth's own public
 * JWKS, not the Supabase project's first-party Auth JWKS.
 *
 * On the exact isolated staging Supabase project, the issuer and audience
 * are supplied from pinned constants when environment overrides are absent.
 * Other projects must explicitly set both server-side values.
 *
 * The returned ctx.supabase is scoped to the caller's RLS policies.
 * ctx.supabaseAdmin bypasses RLS and must only be used after explicit
 * owner/business-role checks in the calling function.
 */
export async function requireBetterAuthUser(request: Request) {
  const { issuer, audience } = resolveBetterAuthVerifierConfig({
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    issuer: Deno.env.get("BETTER_AUTH_ISSUER"),
    audience: Deno.env.get("BETTER_AUTH_RESOURCE_AUDIENCE"),
  });
  if (
    issuer !== EXPECTED_BETTER_AUTH_ISSUER ||
    audience !== EXPECTED_RESOURCE_AUDIENCE
  ) {
    return { ok: false, status: 503, error: "AUTH_IDENTITY_CONFIGURATION_MISSING" };
  }

  // Better Auth's JWT plugin publishes its ES256 signing keys at
  // {issuer}/jwks. Pin the exact host/path above before constructing the URL;
  // never accept a caller-supplied JWKS address or an arbitrary env endpoint.
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!COMPACT_JWT_PATTERN.test(bearer)) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  const betterAuthJwks = new URL("jwks", issuer + "/");

  let result;
  try {
    result = await createSupabaseContext(request, {
      auth: "user",
      issuer: EXPECTED_BETTER_AUTH_ISSUER,
      audience: EXPECTED_RESOURCE_AUDIENCE,
      env: {
        jwks: betterAuthJwks,
      },
    });
  } catch {
    return { ok: false, status: 503, error: "AUTH_VERIFICATION_UNAVAILABLE" };
  }

  const context = result?.data;
  if (result?.error || !context) {
    const status = Number(result?.error?.status ?? 0);
    return status >= 500
      ? { ok: false, status: 503, error: "AUTH_VERIFICATION_UNAVAILABLE" }
      : { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  // jwtClaims are trusted only because createSupabaseContext has verified the
  // request credential against the pinned Better Auth JWKS. The pure
  // validator below enforces SYKABELAJAR's stricter UUID/role/lifetime policy.
  const identity = validateBetterAuthClaims(context.jwtClaims, {
    issuer: EXPECTED_BETTER_AUTH_ISSUER,
    audience: EXPECTED_RESOURCE_AUDIENCE,
  });
  if (!identity.ok) {
    return { ok: false, status: 401, error: identity.reason };
  }

  // Supabase's userClaims.id is the normalized identity derived from the
  // verified token. It must agree with sub; never accept a separate user ID
  // supplied in the request body or user-editable metadata.
  if (context.userClaims?.id !== identity.userId) {
    return { ok: false, status: 401, error: "AUTH_SUBJECT_MISMATCH" };
  }
  if (context.userClaims?.role !== "authenticated") {
    return { ok: false, status: 401, error: "AUTH_POSTGRES_ROLE_INVALID" };
  }

  return {
    ok: true,
    userId: identity.userId,
    userEmail: typeof context.userClaims?.email === "string" ? context.userClaims.email : null,
    issuer: identity.issuer,
    context,
    supabase: context.supabase,
    supabaseAdmin: context.supabaseAdmin,
  };
}

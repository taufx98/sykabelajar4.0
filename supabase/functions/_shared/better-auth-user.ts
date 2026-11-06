import { createSupabaseContext } from "npm:@supabase/server@1.9.2";
import { validateBetterAuthClaims } from "./auth-claims.mjs";

/**
 * Authenticate a Better Auth access token through Supabase's supported
 * third-party JWT verifier. Do not replace this with JWT decoding or a
 * hand-rolled signature check.
 *
 * Required server-only Edge Function environment:
 * - BETTER_AUTH_ISSUER=https://auth.sykabelajar.my.id/api/auth
 * - BETTER_AUTH_RESOURCE_AUDIENCE=https://sykabelajar.my.id
 *
 * The returned ctx.supabase is scoped to the caller's RLS policies.
 * ctx.supabaseAdmin bypasses RLS and must only be used after explicit
 * owner/business-role checks in the calling function.
 */
export async function requireBetterAuthUser(request) {
  const issuer = Deno.env.get("BETTER_AUTH_ISSUER")?.trim();
  const audience = Deno.env.get("BETTER_AUTH_RESOURCE_AUDIENCE")?.trim();
  if (!issuer || !audience) {
    return { ok: false, status: 503, error: "AUTH_IDENTITY_CONFIGURATION_MISSING" };
  }

  let result;
  try {
    result = await createSupabaseContext(request, { auth: "user" });
  } catch {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  const context = result?.data;
  if (result?.error || !context) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  // jwtClaims are trusted only because createSupabaseContext has verified the
  // request credential. The pure validator below enforces this app's stricter
  // issuer/audience/UUID/role/five-minute token contract.
  const identity = validateBetterAuthClaims(context.jwtClaims, { issuer, audience });
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

import { createSupabaseContext } from "npm:@supabase/server@1.9.2";

const EXPECTED_ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const EXPECTED_AUDIENCE = "https://sykabelajar.my.id";
const BETTER_AUTH_JWKS = new URL("jwks", EXPECTED_ISSUER + "/");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Staging-only, read-only acceptance probe for the Better Auth Custom OIDC
 * issuer. Platform verify_jwt is disabled because the handler uses the pinned
 * @supabase/server verifier with the exact Better Auth JWKS/issuer/audience.
 * No service-role client is used.
 */
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let result;
  try {
    result = await createSupabaseContext(request, {
      auth: "user",
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
      env: { jwks: BETTER_AUTH_JWKS },
    });
  } catch {
    return json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503);
  }

  const context = result?.data;
  if (result?.error || !context) {
    const status = Number(result?.error?.status ?? 0);
    return status >= 500
      ? json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503)
      : json({ error: "AUTH_REQUIRED" }, 401);
  }

  const claims = context.jwtClaims as Record<string, unknown> | undefined;
  const userId = typeof claims?.sub === "string" ? claims.sub : "";
  const now = Math.floor(Date.now() / 1000);
  const audiences = typeof claims?.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims?.aud) && claims.aud.every((item) => typeof item === "string")
      ? claims.aud as string[]
      : [];

  if (
    claims?.iss !== EXPECTED_ISSUER ||
    !UUID_PATTERN.test(userId) ||
    claims?.role !== "authenticated" ||
    !audiences.includes(EXPECTED_AUDIENCE) ||
    !Number.isSafeInteger(claims?.iat) ||
    !Number.isSafeInteger(claims?.exp) ||
    Number(claims?.iat) > now + 30 ||
    Number(claims?.exp) <= now ||
    Number(claims?.exp) - Number(claims?.iat) > 300 ||
    context.userClaims?.id !== userId ||
    context.userClaims?.role !== "authenticated"
  ) {
    return json({ error: "BETTER_AUTH_CLAIMS_REJECTED" }, 401);
  }

  // This staging-only query must return rows owned by the verified UUID only.
  const { data, error } = await context.supabase
    .from("auth_oidc_acceptance_rows")
    .select("id, owner_id, note");

  if (error) return json({ error: "OIDC_RLS_FIXTURE_QUERY_FAILED" }, 503);

  const rows = Array.isArray(data) ? data : [];
  const crossUserRows = rows.filter((row: { owner_id?: string }) => row.owner_id !== userId);
  if (crossUserRows.length > 0) return json({ error: "OIDC_RLS_ISOLATION_FAILED" }, 403);

  return json({
    ok: true,
    user_id: userId,
    issuer: EXPECTED_ISSUER,
    audience: EXPECTED_AUDIENCE,
    postgres_role: "authenticated",
    visible_fixture_rows: rows.length,
    cross_user_rows: 0,
    read_only: true,
    production_touched: false,
  });
});

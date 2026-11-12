import { createSupabaseContext } from "npm:@supabase/server@1.9.2";

const EXPECTED_ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const EXPECTED_AUDIENCE = "https://sykabelajar.my.id";
const BETTER_AUTH_JWKS = new URL("jwks", EXPECTED_ISSUER + "/");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STAGING_APP_ORIGIN = "https://staging.sykabelajar.my.id";
const CORS_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  "traceparent",
  "tracestate",
  "baggage",
  "x-supabase-api-version",
];
const CORS_ALLOW_HEADERS_VALUE = CORS_ALLOWED_HEADERS.join(", ");

function stagingCorsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": STAGING_APP_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS_VALUE,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  });
}

function json(body: unknown, status = 200, responseHeaders?: HeadersInit): Response {
  const headers = new Headers(responseHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Staging-only, read-only acceptance probe for the Better Auth Custom OIDC
 * issuer. Platform verify_jwt is disabled because the handler uses the pinned
 * @supabase/server verifier with the exact Better Auth JWKS/issuer/audience.
 * No service-role client is used.
 */
Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== STAGING_APP_ORIGIN) {
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  const responseHeaders = origin === STAGING_APP_ORIGIN
    ? stagingCorsHeaders()
    : new Headers();

  if (request.method === "OPTIONS") {
    if (origin !== STAGING_APP_ORIGIN) {
      return new Response(null, { status: 403 });
    }

    const requestedMethod = request.headers.get("Access-Control-Request-Method");
    if (requestedMethod && requestedMethod.toUpperCase() !== "POST") {
      return json({ error: "CORS_METHOD_NOT_ALLOWED" }, 405, responseHeaders);
    }

    const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => !CORS_ALLOWED_HEADERS.includes(header))) {
      return json({ error: "CORS_REQUEST_HEADER_NOT_ALLOWED" }, 403, responseHeaders);
    }

    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, responseHeaders);
  }

  let result;
  try {
    result = await createSupabaseContext(request, {
      auth: "user",
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
      env: { jwks: BETTER_AUTH_JWKS },
    });
  } catch {
    return json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503, responseHeaders);
  }

  const context = result?.data;
  if (result?.error || !context) {
    const status = Number(result?.error?.status ?? 0);
    return status >= 500
      ? json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503, responseHeaders)
      : json({ error: "AUTH_REQUIRED" }, 401, responseHeaders);
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
    return json({ error: "BETTER_AUTH_CLAIMS_REJECTED" }, 401, responseHeaders);
  }

  // This staging-only query must return rows owned by the verified UUID only.
  const { data, error } = await context.supabase
    .from("auth_oidc_acceptance_rows")
    .select("id, owner_id, note");

  if (error) return json({ error: "OIDC_RLS_FIXTURE_QUERY_FAILED" }, 503, responseHeaders);

  const rows = Array.isArray(data) ? data : [];
  const crossUserRows = rows.filter((row: { owner_id?: string }) => row.owner_id !== userId);
  if (crossUserRows.length > 0) return json({ error: "OIDC_RLS_ISOLATION_FAILED" }, 403, responseHeaders);

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
  }, 200, responseHeaders);
});

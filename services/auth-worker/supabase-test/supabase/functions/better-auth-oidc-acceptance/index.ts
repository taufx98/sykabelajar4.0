import { requireApplicationUser } from "./_shared/require-application-user.ts";

const EXPECTED_ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const EXPECTED_AUDIENCE = "https://sykabelajar.my.id";
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
 * Staging-only, read-only acceptance probe for the exact shared
 * requireApplicationUser() path used by the migrated Cloudinary/payment
 * handlers. It deploys no business handler and queries only the isolated
 * auth_oidc_acceptance_rows fixture using the caller-scoped Supabase client.
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

  // This is the identical identity adapter imported by migrated business
  // handlers. Missing, malformed, expired, wrong-issuer and wrong-audience
  // credentials fail closed before the caller-scoped database query.
  let identity: Awaited<ReturnType<typeof requireApplicationUser>>;
  try {
    identity = await requireApplicationUser(request);
  } catch {
    return json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503, responseHeaders);
  }
  if (!identity.ok) {
    return json({ error: identity.error }, identity.status, responseHeaders);
  }
  if (identity.mode !== "better-auth") {
    return json({ error: "BETTER_AUTH_MODE_REQUIRED" }, 503, responseHeaders);
  }

  const { data, error } = await identity.supabase
    .from("auth_oidc_acceptance_rows")
    .select("id, owner_id, note");

  if (error) return json({ error: "OIDC_RLS_FIXTURE_QUERY_FAILED" }, 503, responseHeaders);

  const rows = Array.isArray(data) ? data : [];
  const crossUserRows = rows.filter((row: { owner_id?: string }) => row.owner_id !== identity.userId);
  if (crossUserRows.length > 0) {
    return json({ error: "OIDC_RLS_ISOLATION_FAILED" }, 403, responseHeaders);
  }

  return json({
    ok: true,
    user_id: identity.userId,
    identity_mode: identity.mode,
    issuer: EXPECTED_ISSUER,
    audience: EXPECTED_AUDIENCE,
    postgres_role: "authenticated",
    visible_fixture_rows: rows.length,
    cross_user_rows: 0,
    read_only: true,
    production_touched: false,
  }, 200, responseHeaders);
});

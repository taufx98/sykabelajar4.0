import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth";
import type { AuthWorkerEnv } from "./env";
import {
  applyResponseHeaders,
  createCorsHeaders,
  timingSafeEqualString,
} from "./security.mjs";
import { createD1QuotaResponse } from "./d1-quota.mjs";
import { handleEmailAdminRequest } from "./email-admin";

const authInstances = new WeakMap<object, ReturnType<typeof createAuth>>();

function getAuth(env: AuthWorkerEnv) {
  const key = env.DB as object;
  const existing = authInstances.get(key);
  if (existing) return existing;

  const auth = createAuth(env);
  authInstances.set(key, auth);
  return auth;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

async function generateD1Schema(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const expectedToken = env.D1_SCHEMA_BOOTSTRAP_TOKEN;
  const suppliedToken = bearerToken(request);
  let isLocalWorker = false;
  try {
    const hostname = new URL(env.BETTER_AUTH_URL).hostname;
    isLocalWorker = hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    isLocalWorker = false;
  }

  // This endpoint can never run against a non-local auth origin, even if
  // someone accidentally sets the bootstrap flag in a shared environment.
  if (
    request.method !== "POST" ||
    request.headers.has("Origin") ||
    !isLocalWorker ||
    env.ALLOW_SCHEMA_BOOTSTRAP !== "true" ||
    !expectedToken ||
    expectedToken.length < 32 ||
    !suppliedToken ||
    !timingSafeEqualString(expectedToken, suppliedToken)
  ) {
    return json({ error: "NOT_FOUND" }, 404);
  }

  try {
    // Cloudflare D1 bindings are request-scoped. Running Better Auth's
    // supported migrator here avoids trying to initialize D1 from Node CLI.
    const migrations = await getMigrations(getAuth(env).options);
    await migrations.runMigrations();

    const schema = await env.DB
      .prepare(
        "SELECT name, type, sql FROM sqlite_master " +
        "WHERE type IN ('table', 'index') " +
        "AND name NOT LIKE 'sqlite_%' " +
        "AND name NOT IN ('auth_worker_internal_config', 'auth_email_accounts', 'auth_email_settings', 'auth_email_admin_test_limits', '_cf_METADATA', 'd1_migrations') " +
        "AND sql IS NOT NULL " +
        "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      )
      .all<{ name: string; type: string; sql: string }>();

    const ddl = (schema.results ?? []).map((row) => ({
      name: row.name,
      type: row.type,
      sql: row.sql,
    }));

    if (ddl.length === 0) return json({ error: "AUTH_SCHEMA_EMPTY" }, 503);
    return json({
      ok: true,
      table_names: ddl.filter((item) => item.type === "table").map((item) => item.name),
      ddl,
    });
  } catch {
    return json({ error: "AUTH_SCHEMA_BOOTSTRAP_FAILED" }, 503);
  }
}

async function bootstrapFirstPartyClient(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const expectedToken = env.OAUTH_CLIENT_BOOTSTRAP_TOKEN;
  const suppliedToken = bearerToken(request);

  if (
    request.method !== "POST" ||
    request.headers.has("Origin") ||
    !expectedToken ||
    expectedToken.length < 32 ||
    !suppliedToken ||
    !timingSafeEqualString(expectedToken, suppliedToken)
  ) {
    return json({ error: "NOT_FOUND" }, 404);
  }

  const callbackUrl = env.OAUTH_CALLBACK_URL;
  const resourceAudience = env.SUPABASE_RESOURCE_AUDIENCE;
  if (!callbackUrl || !resourceAudience) {
    return json({ error: "OAUTH_CLIENT_BOOTSTRAP_NOT_CONFIGURED" }, 503);
  }

  let parsedCallback: URL;
  let parsedResource: URL;
  try {
    parsedCallback = new URL(callbackUrl);
    parsedResource = new URL(resourceAudience);
  } catch {
    return json({ error: "OAUTH_CLIENT_BOOTSTRAP_URL_INVALID" }, 503);
  }

  if (
    parsedCallback.origin !== env.APP_ORIGIN ||
    parsedCallback.protocol !== "https:" ||
    parsedCallback.username ||
    parsedCallback.password ||
    parsedCallback.hash ||
    parsedCallback.search ||
    parsedResource.protocol !== "https:" ||
    parsedResource.origin !== resourceAudience.replace(/\/$/, "")
  ) {
    return json({ error: "OAUTH_CLIENT_BOOTSTRAP_URL_NOT_ALLOWED" }, 503);
  }

  try {
    const seeded = await env.DB
      .prepare(
        "SELECT c.clientId AS client_id, c.clientSecret AS client_secret, " +
        "c.disabled AS disabled, c.scopes AS scopes, c.redirectUris AS redirect_uris, " +
        "c.tokenEndpointAuthMethod AS token_endpoint_auth_method, " +
        "c.grantTypes AS grant_types, c.responseTypes AS response_types, " +
        "c.requirePKCE AS require_pkce, r.resourceId AS resource_id " +
        "FROM auth_worker_internal_config AS cfg " +
        "JOIN oauthClient AS c ON c.clientId = cfg.value " +
        "JOIN oauthClientResource AS r ON r.clientId = c.clientId " +
        "WHERE cfg.key = ?1 AND cfg.value <> 'pending'",
      )
      .bind("first_party_oauth_client_id")
      .first<{
        client_id: string;
        client_secret: string | null;
        disabled: number | null;
        scopes: string;
        redirect_uris: string;
        token_endpoint_auth_method: string;
        grant_types: string;
        response_types: string;
        require_pkce: number | null;
        resource_id: string;
      }>();

    if (!seeded) return json({ error: "OAUTH_CLIENT_NOT_SEEDED" }, 503);

    const scopes = JSON.parse(seeded.scopes) as string[];
    const redirectUris = JSON.parse(seeded.redirect_uris) as string[];
    const grantTypes = JSON.parse(seeded.grant_types) as string[];
    const responseTypes = JSON.parse(seeded.response_types) as string[];

    const valid =
      seeded.client_secret === null &&
      seeded.disabled === 0 &&
      seeded.token_endpoint_auth_method === "none" &&
      seeded.require_pkce === 1 &&
      seeded.resource_id === resourceAudience &&
      scopes.includes("openid") &&
      scopes.includes("profile") &&
      scopes.includes("email") &&
      redirectUris.length === 1 &&
      redirectUris[0] === callbackUrl &&
      grantTypes.length === 1 &&
      grantTypes[0] === "authorization_code" &&
      responseTypes.length === 1 &&
      responseTypes[0] === "code";

    if (!valid) return json({ error: "OAUTH_CLIENT_SEED_INVALID" }, 503);

    return json({ client_id: seeded.client_id, already_configured: true });
  } catch (error) {
    const safeReason = error instanceof Error
      ? { name: error.name.slice(0, 60), message: error.message.replace(/[^a-zA-Z0-9 _.:/-]/g, "").slice(0, 160) }
      : { name: "UnknownError", message: "unclassified" };
    console.error("First-party OAuth client verification failed", safeReason);
    return json({ error: "OAUTH_CLIENT_SEED_UNAVAILABLE" }, 503);
  }
}

export default {
  async fetch(request: Request, env: AuthWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const allowedOrigins = [env.APP_ORIGIN, ...(env.DEV_APP_ORIGIN ? [env.DEV_APP_ORIGIN] : [])];
    const corsHeaders = createCorsHeaders(request, allowedOrigins);

    if (url.pathname === "/bootz" && request.method === "GET") {
      return applyResponseHeaders(
        json({ status: "ok", service: "sykabelajar-auth-worker" }),
        corsHeaders,
      );
    }

    if (request.method === "OPTIONS") {
      if (!corsHeaders) return new Response(null, { status: 403 });
      return applyResponseHeaders(new Response(null, { status: 204 }), corsHeaders);
    }

    if (url.pathname === "/healthz" && request.method === "GET") {
      try {
        await env.DB.prepare("select 1 as ok").first();
        return applyResponseHeaders(json({ ok: true, service: "sykabelajar-auth-poc" }), corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, service: "sykabelajar-auth-poc" }, 503), corsHeaders);
      }
    }

    if (url.pathname === "/_internal/schema-migrate") {
      return applyResponseHeaders(await generateD1Schema(request, env), null);
    }

    if (url.pathname === "/_internal/bootstrap-first-party-client") {
      return applyResponseHeaders(await bootstrapFirstPartyClient(request, env), null);
    }

    if (url.pathname === "/api/admin/email-settings") {
      try {
        const response = await handleEmailAdminRequest(request, env);
        return applyResponseHeaders(response, corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, error: "EMAIL_SETTINGS_UNAVAILABLE" }, 503), corsHeaders);
      }
    }

    if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth") {
      return applyResponseHeaders(json({ error: "NOT_FOUND" }, 404), corsHeaders);
    }

    try {
      const response = await getAuth(env).handler(request);
      return applyResponseHeaders(response, corsHeaders);
    } catch (error) {
      const quotaResponse = createD1QuotaResponse(error);
      if (quotaResponse) {
        return applyResponseHeaders(quotaResponse, corsHeaders);
      }
      return applyResponseHeaders(json({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503), corsHeaders);
    }
  },
} satisfies ExportedHandler<AuthWorkerEnv>;

import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth";
import type { AuthWorkerEnv } from "./env";
import {
  applyResponseHeaders,
  createCorsHeaders,
  timingSafeEqualString,
} from "./security.mjs";

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
        "AND name <> 'auth_worker_internal_config' " +
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
  if (!callbackUrl) return json({ error: "OAUTH_CLIENT_BOOTSTRAP_NOT_CONFIGURED" }, 503);

  let parsedCallback: URL;
  try {
    parsedCallback = new URL(callbackUrl);
  } catch {
    return json({ error: "OAUTH_CALLBACK_URL_INVALID" }, 503);
  }

  if (
    parsedCallback.origin !== env.APP_ORIGIN ||
    parsedCallback.protocol !== "https:" ||
    parsedCallback.username ||
    parsedCallback.password ||
    parsedCallback.hash ||
    parsedCallback.search
  ) {
    return json({ error: "OAUTH_CALLBACK_URL_NOT_ALLOWED" }, 503);
  }

  try {
    const existing = await env.DB
      .prepare("SELECT value, created_at FROM auth_worker_internal_config WHERE key = ?1")
      .bind("first_party_oauth_client_id")
      .first<{ value: string; created_at: string }>();

    if (existing && existing.value !== "pending") {
      return json({ client_id: existing.value, already_configured: true });
    }

    if (existing?.value === "pending") {
      const insertedAt = Date.parse(existing.created_at);
      const stale = Number.isFinite(insertedAt) && Date.now() - insertedAt > 10 * 60 * 1000;
      if (!stale) return json({ error: "OAUTH_CLIENT_BOOTSTRAP_IN_PROGRESS" }, 409);

      await env.DB
        .prepare("DELETE FROM auth_worker_internal_config WHERE key = ?1 AND value = 'pending'")
        .bind("first_party_oauth_client_id")
        .run();
    }

    const reservation = await env.DB
      .prepare("INSERT INTO auth_worker_internal_config (key, value, created_at) VALUES (?1, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO NOTHING")
      .bind("first_party_oauth_client_id")
      .run();

    if ((reservation.meta?.changes ?? 0) !== 1) {
      return json({ error: "OAUTH_CLIENT_BOOTSTRAP_IN_PROGRESS" }, 409);
    }

    try {
      const created = await getAuth(env).api.adminCreateOAuthClient({
        body: {
          client_name: "SYKABELAJAR Web",
          redirect_uris: [callbackUrl],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: "openid profile email",
          resources: [env.SUPABASE_RESOURCE_AUDIENCE],
          client_secret_expires_at: 0,
          skip_consent: true,
        },
      });

      const clientId = created.client_id;
      if (!clientId) throw new Error("OAUTH_CLIENT_ID_NOT_RETURNED");

      const stored = await env.DB
        .prepare("UPDATE auth_worker_internal_config SET value = ?1, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?2 AND value = 'pending'")
        .bind(clientId, "first_party_oauth_client_id")
        .run();

      if ((stored.meta?.changes ?? 0) !== 1) {
        throw new Error("OAUTH_CLIENT_BOOTSTRAP_RESERVATION_LOST");
      }

      return json({ client_id: clientId, already_configured: false }, 201);
    } catch {
      await env.DB
        .prepare("DELETE FROM auth_worker_internal_config WHERE key = ?1 AND value = 'pending'")
        .bind("first_party_oauth_client_id")
        .run();
      return json({ error: "OAUTH_CLIENT_BOOTSTRAP_FAILED" }, 503);
    }
  } catch {
    return json({ error: "OAUTH_CLIENT_BOOTSTRAP_UNAVAILABLE" }, 503);
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

    if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth") {
      return applyResponseHeaders(json({ error: "NOT_FOUND" }, 404), corsHeaders);
    }

    try {
      const response = await getAuth(env).handler(request);
      return applyResponseHeaders(response, corsHeaders);
    } catch {
      return applyResponseHeaders(json({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503), corsHeaders);
    }
  },
} satisfies ExportedHandler<AuthWorkerEnv>;

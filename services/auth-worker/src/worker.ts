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
import { isAuthEmailVerificationConfigured } from "./email";
import {
  getPublicSocialLoginProviders,
  handleLoginProviderAdminRequest,
  readSocialProviderConfiguration,
} from "./social-provider-settings";
import { isSupabaseProvisioningEnabled, completeSupabasePhoneVerification, getSupabasePhoneVerificationStatus } from "./supabase-provisioning.mjs";
import {
  createTelegramPhoneChallenge,
  consumeTelegramPhoneChallenge,
  exchangeTelegramAuthorizationCode,
  getTelegramPhoneRedirectUri,
  isTelegramPhoneVerificationConfigured,
  sha256Hex,
  verifyTelegramPhoneIdToken,
} from "./telegram-phone-verification.mjs";

type CachedAuthInstance = {
  revision: number;
  managedMode: boolean;
  auth: ReturnType<typeof createAuth>;
};
const authInstances = new WeakMap<object, CachedAuthInstance>();

async function getAuth(env: AuthWorkerEnv) {
  const key = env.DB as object;
  const config = await readSocialProviderConfiguration(env);
  const existing = authInstances.get(key);
  if (
    existing &&
    existing.revision === config.revision &&
    existing.managedMode === config.managedMode
  ) {
    return existing.auth;
  }

  const auth = createAuth(env, config);
  authInstances.set(key, {
    revision: config.revision,
    managedMode: config.managedMode,
    auth,
  });
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
function safeDiagnostic(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: "UnknownError", message: "unclassified" };
  const message = error.message
    .replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
  return { name: error.name.slice(0, 60), message: message || "unclassified" };
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
    // Schema bootstrap runs before the custom social-provider tables exist.
    // Build only the static Better Auth core options here; normal requests load
    // dynamic provider settings after migration 0007 is present.
    const auth = createAuth(env);
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();

    const schema = await env.DB
      .prepare(
        "SELECT name, type, sql FROM sqlite_master " +
        "WHERE type IN ('table', 'index') " +
        "AND name NOT LIKE 'sqlite_%' " +
        "AND name NOT IN ('auth_worker_internal_config', 'auth_email_accounts', 'auth_email_settings', 'auth_email_admin_test_limits', 'auth_social_provider_settings', 'auth_social_provider_meta', '_cf_METADATA', 'd1_migrations') " +
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
  } catch (error) {
    console.error("Auth schema bootstrap failed", safeDiagnostic(error));
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

  const productionCallbackUrl = new URL("/auth/oidc/callback", env.APP_ORIGIN).toString();
  const stagingCallbackUrl = "https://staging.sykabelajar.my.id/auth/oidc/callback";
  const approvedCallbackUrls = [productionCallbackUrl, stagingCallbackUrl];

  if (
    !approvedCallbackUrls.includes(callbackUrl) ||
    parsedCallback.pathname !== "/auth/oidc/callback" ||
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
      redirectUris.length === approvedCallbackUrls.length &&
      approvedCallbackUrls.every((uri) => redirectUris.includes(uri)) &&
      redirectUris.every((uri) => approvedCallbackUrls.includes(uri)) &&
      redirectUris.includes(callbackUrl) &&
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


function phoneVerificationRedirect(env: AuthWorkerEnv, status: "success" | "failed", reason?: string): Response {
  let location: URL;
  try {
    const app = new URL(env.APP_ORIGIN);
    if (app.protocol !== "https:" || app.origin !== env.APP_ORIGIN.replace(/\/$/, "")) {
      throw new Error("APP_ORIGIN_INVALID");
    }
    location = new URL("/organizer", app.origin);
  } catch {
    return json({ error: "PHONE_VERIFICATION_REDIRECT_UNAVAILABLE" }, 503);
  }
  location.searchParams.set("phoneVerification", status);
  if (reason) location.searchParams.set("reason", reason);
  return new Response(null, {
    status: 303,
    headers: {
      Location: location.toString(),
      "Cache-Control": "no-store",
    },
  });
}

async function startTelegramPhoneVerification(
  request: Request,
  env: AuthWorkerEnv,
  corsHeaders: Headers | null,
): Promise<Response> {
  if (request.method !== "POST") {
    return applyResponseHeaders(json({ error: "METHOD_NOT_ALLOWED" }, 405), corsHeaders);
  }
  if (!corsHeaders) {
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (
    !isSupabaseProvisioningEnabled(env) ||
    !isTelegramPhoneVerificationConfigured(env)
  ) {
    return applyResponseHeaders(json({ error: "PHONE_VERIFICATION_NOT_CONFIGURED" }, 503), corsHeaders);
  }

  try {
    const auth = await getAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (typeof userId !== "string" || !userId) {
      return applyResponseHeaders(json({ error: "AUTHENTICATION_REQUIRED" }, 401), corsHeaders);
    }

    const challenge = await createTelegramPhoneChallenge(env, userId);
    return applyResponseHeaders(json({
      authorization_url: challenge.authorizationUrl,
      expires_at: new Date(challenge.expiresAt).toISOString(),
    }), corsHeaders);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PHONE_VERIFICATION_START_FAILED";
    if (code === "TELEGRAM_PHONE_VERIFICATION_RATE_LIMITED") {
      return applyResponseHeaders(json({ error: code }, 429), corsHeaders);
    }
    return applyResponseHeaders(json({
      error: code === "TELEGRAM_PHONE_VERIFICATION_NOT_CONFIGURED"
        ? code
        : "PHONE_VERIFICATION_START_FAILED",
    }, 503), corsHeaders);
  }
}


async function getTelegramPhoneVerificationStatus(
  request: Request,
  env: AuthWorkerEnv,
  corsHeaders: Headers | null,
): Promise<Response> {
  if (request.method !== "GET") {
    return applyResponseHeaders(json({ error: "METHOD_NOT_ALLOWED" }, 405), corsHeaders);
  }
  if (!corsHeaders) {
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (!isSupabaseProvisioningEnabled(env)) {
    return applyResponseHeaders(json({ error: "PHONE_VERIFICATION_STATUS_UNAVAILABLE" }, 503), corsHeaders);
  }

  try {
    const auth = await getAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (typeof userId !== "string" || !userId) {
      return applyResponseHeaders(json({ error: "AUTHENTICATION_REQUIRED" }, 401), corsHeaders);
    }
    const status = await getSupabasePhoneVerificationStatus(env, userId);
    return applyResponseHeaders(json({ verified: status.verified }), corsHeaders);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return applyResponseHeaders(json({
      error: code === "SUPABASE_PROVISIONING_RPC_NOT_INSTALLED"
        ? "PHONE_VERIFICATION_STATUS_NOT_READY"
        : "PHONE_VERIFICATION_STATUS_UNAVAILABLE",
    }, 503), corsHeaders);
  }
}

async function completeTelegramPhoneCallback(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return phoneVerificationRedirect(env, "failed", "invalid_state");

  let challengeRow: Record<string, unknown> | null;
  try {
    challengeRow = await consumeTelegramPhoneChallenge(env, state);
  } catch {
    return phoneVerificationRedirect(env, "failed", "temporarily_unavailable");
  }
  if (
    !challengeRow ||
    typeof challengeRow.user_id !== "string" ||
    typeof challengeRow.nonce !== "string" ||
    typeof challengeRow.code_verifier !== "string" ||
    challengeRow.nonce.length < 40 ||
    challengeRow.code_verifier.length < 43 ||
    !Number.isFinite(Number(challengeRow.created_at)) ||
    !Number.isFinite(Number(challengeRow.expires_at))
  ) {
    return phoneVerificationRedirect(env, "failed", "expired_or_used");
  }
  const challenge = {
    user_id: challengeRow.user_id,
    nonce: challengeRow.nonce,
    code_verifier: challengeRow.code_verifier,
    created_at: Number(challengeRow.created_at),
    expires_at: Number(challengeRow.expires_at),
  };

  if (url.searchParams.has("error")) {
    return phoneVerificationRedirect(env, "failed", "telegram_consent_denied");
  }
  const code = url.searchParams.get("code");
  if (!code) return phoneVerificationRedirect(env, "failed", "authorization_code_missing");
  if (
    !isSupabaseProvisioningEnabled(env) ||
    !isTelegramPhoneVerificationConfigured(env)
  ) {
    return phoneVerificationRedirect(env, "failed", "temporarily_unavailable");
  }

  try {
    const clientId = env.AUTH_TELEGRAM_CLIENT_ID!.trim();
    const clientSecret = env.AUTH_TELEGRAM_CLIENT_SECRET!.trim();
    const redirectUri = getTelegramPhoneRedirectUri(env.BETTER_AUTH_URL);
    const idToken = await exchangeTelegramAuthorizationCode({
      code,
      codeVerifier: challenge.code_verifier,
      clientId,
      clientSecret,
      redirectUri,
    });
    const claims = await verifyTelegramPhoneIdToken({
      idToken,
      clientId,
      expectedNonce: challenge.nonce,
    });
    const phoneHash = await sha256Hex(claims.phoneDigits);
    await completeSupabasePhoneVerification(env, {
      userId: challenge.user_id,
      verifiedAt: new Date().toISOString(),
      phoneHash,
      providerSubject: claims.providerSubject,
      phoneDigitsCount: claims.phoneDigitsCount,
    });
    return phoneVerificationRedirect(env, "success");
  } catch {
    // Do not log or return phone claims, tokens, provider responses or secrets.
    return phoneVerificationRedirect(env, "failed", "verification_failed");
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

    if (url.pathname === "/api/phone-verification/telegram/status") {
      return getTelegramPhoneVerificationStatus(request, env, corsHeaders);
    }

    if (url.pathname === "/api/phone-verification/telegram/start") {
      return startTelegramPhoneVerification(request, env, corsHeaders);
    }

    if (url.pathname === "/phone-verification/telegram/callback") {
      if (request.method !== "GET") {
        return applyResponseHeaders(json({ error: "METHOD_NOT_ALLOWED" }, 405), null);
      }
      return applyResponseHeaders(await completeTelegramPhoneCallback(request, env), null);
    }

    if (url.pathname === "/api/admin/email-settings") {
      try {
        const response = await handleEmailAdminRequest(request, env);
        return applyResponseHeaders(response, corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, error: "EMAIL_SETTINGS_UNAVAILABLE" }, 503), corsHeaders);
      }
    }

    if (url.pathname === "/api/admin/login-providers") {
      try {
        const response = await handleLoginProviderAdminRequest(request, env);
        return applyResponseHeaders(response, corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, error: "SOCIAL_PROVIDER_SETTINGS_UNAVAILABLE" }, 503), corsHeaders);
      }
    }

    if (url.pathname === "/api/auth/providers") {
      if (request.method !== "GET") {
        return applyResponseHeaders(json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405), corsHeaders);
      }
      try {
        const response = await getPublicSocialLoginProviders(env);
        return applyResponseHeaders(response, corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, error: "SOCIAL_PROVIDER_LIST_UNAVAILABLE" }, 503), corsHeaders);
      }
    }

    if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth") {
      return applyResponseHeaders(json({ error: "NOT_FOUND" }, 404), corsHeaders);
    }

    // The frontend readiness check is only UX. Enforce the same gate at
    // the Worker boundary so direct Better Auth API calls cannot create an
    // unverified account when the verification-email sender is unavailable.
    if (request.method === "POST" && url.pathname === "/api/auth/sign-up/email") {
      const emailDeliveryReady = await isAuthEmailVerificationConfigured(env);
      if (!emailDeliveryReady) {
        return applyResponseHeaders(
          json({ error: "EMAIL_VERIFICATION_DELIVERY_NOT_CONFIGURED" }, 503),
          corsHeaders,
        );
      }
    }

    try {
      const auth = await getAuth(env);
      const response = await auth.handler(request);
      if (response.status >= 500 && url.pathname.startsWith("/api/auth/")) {
        let providerError = "AUTH_HANDLER_ERROR";
        try {
          const payload = await response.clone().json() as { code?: unknown; error?: unknown; message?: unknown };
          const candidate = [payload.code, payload.error, payload.message]
            .find((value) => typeof value === "string" && /^[A-Z0-9_]{2,80}$/.test(value));
          if (typeof candidate === "string") providerError = candidate;
        } catch {
          // Log only a stable code and path; never emit response bodies or tokens.
        }
        console.error("Better Auth handler returned an error response", {
          status: response.status,
          path: url.pathname,
          code: providerError,
        });
      }
      return applyResponseHeaders(response, corsHeaders);
    } catch (error) {
      const quotaResponse = createD1QuotaResponse(error);
      if (quotaResponse) {
        return applyResponseHeaders(quotaResponse, corsHeaders);
      }
      console.error("Better Auth request failed", safeDiagnostic(error));
      return applyResponseHeaders(json({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503), corsHeaders);
    }
  },
} satisfies ExportedHandler<AuthWorkerEnv>;

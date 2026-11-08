import type { AuthWorkerEnv } from "./env";
import {
  decryptSocialProviderSecret,
  encryptSocialProviderSecret,
} from "./social-provider-secret.mjs";
import {
  BetterAuthAdminAuthError,
  isBetterAuthTokenForIssuer,
  resolveBetterAuthAdminIdentity,
} from "./email-admin-auth.mjs";

export const SOCIAL_LOGIN_PROVIDERS = ["google", "facebook", "twitter"] as const;
export type SocialLoginProvider = typeof SOCIAL_LOGIN_PROVIDERS[number];
export type SocialProviderCredentials = {
  clientId: string;
  clientSecret: string;
};
export type SocialProviderRuntimeConfig = {
  managedMode: boolean;
  revision: number;
  providers: Partial<Record<SocialLoginProvider, SocialProviderCredentials>>;
};
type SocialProviderRow = {
  provider: SocialLoginProvider;
  client_id: string;
  client_secret_ciphertext: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};
type SocialProviderMeta = {
  revision: number;
  managed_mode: number;
};

const CALLBACK_PATH: Record<SocialLoginProvider, string> = {
  google: "/api/auth/callback/google",
  facebook: "/api/auth/callback/facebook",
  twitter: "/api/auth/callback/twitter",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isProvider(value: unknown): value is SocialLoginProvider {
  return typeof value === "string" &&
    (SOCIAL_LOGIN_PROVIDERS as readonly string[]).includes(value);
}

function environmentProviders(env: AuthWorkerEnv): Partial<Record<SocialLoginProvider, SocialProviderCredentials>> {
  const values = {
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    facebook: [env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET],
    twitter: [env.TWITTER_CLIENT_ID, env.TWITTER_CLIENT_SECRET],
  } as const;
  const result: Partial<Record<SocialLoginProvider, SocialProviderCredentials>> = {};
  for (const provider of SOCIAL_LOGIN_PROVIDERS) {
    const [clientId, clientSecret] = values[provider];
    if (Boolean(clientId?.trim()) !== Boolean(clientSecret?.trim())) {
      // Keep the existing strict pair-validation behavior in createAuth().
      continue;
    }
    if (clientId?.trim() && clientSecret?.trim()) {
      result[provider] = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      };
    }
  }
  return result;
}

async function readMeta(db: D1Database): Promise<SocialProviderMeta | null> {
  try {
    return await db.prepare(
      "SELECT revision, managed_mode FROM auth_social_provider_meta WHERE id = 1",
    ).first<SocialProviderMeta>();
  } catch {
    // Before additive migration 0007 is applied, use the existing environment
    // provider configuration. A missing table must not break email/password auth.
    return null;
  }
}

async function readRows(db: D1Database): Promise<SocialProviderRow[]> {
  const result = await db.prepare(
    "SELECT provider, client_id, client_secret_ciphertext, enabled, created_at, updated_at " +
    "FROM auth_social_provider_settings ORDER BY provider ASC",
  ).all<SocialProviderRow>();
  return result.results ?? [];
}

/**
 * Load the social provider config for the current Worker request. A revision
 * change is used by worker.ts to rebuild Better Auth without a Worker redeploy.
 * If the encryption key is absent or a ciphertext fails authentication, that
 * provider is omitted from runtime config (fail closed).
 */
export async function readSocialProviderConfiguration(env: AuthWorkerEnv): Promise<SocialProviderRuntimeConfig> {
  const meta = await readMeta(env.DB);
  if (!meta) {
    return {
      managedMode: false,
      revision: 0,
      providers: environmentProviders(env),
    };
  }
  if (meta.managed_mode !== 1) {
    return {
      managedMode: false,
      revision: meta.revision,
      providers: environmentProviders(env),
    };
  }

  const providers: Partial<Record<SocialLoginProvider, SocialProviderCredentials>> = {};
  let rows: SocialProviderRow[];
  try {
    rows = await readRows(env.DB);
  } catch {
    return { managedMode: true, revision: meta.revision, providers };
  }

  if (!env.AUTH_PROVIDER_ENCRYPTION_KEY || env.AUTH_PROVIDER_ENCRYPTION_KEY.length < 32) {
    return { managedMode: true, revision: meta.revision, providers };
  }

  for (const row of rows) {
    if (!isProvider(row.provider) || row.enabled !== 1) continue;
    try {
      const clientSecret = await decryptSocialProviderSecret(
        env.AUTH_PROVIDER_ENCRYPTION_KEY,
        row.client_secret_ciphertext,
      );
      if (row.client_id.trim() && clientSecret.trim()) {
        providers[row.provider] = {
          clientId: row.client_id.trim(),
          clientSecret,
        };
      }
    } catch {
      // A bad key or tampered ciphertext disables only this provider.
    }
  }
  return { managedMode: true, revision: meta.revision, providers };
}

function callbackUrl(env: AuthWorkerEnv, provider: SocialLoginProvider): string {
  return new URL(CALLBACK_PATH[provider], env.BETTER_AUTH_URL).toString();
}

async function requireBetterAuthAdmin(request: Request, env: AuthWorkerEnv): Promise<
  { user: { id: string; email: string } } | { response: Response }
> {
  const origin = request.headers.get("Origin");
  const allowlist = [env.APP_ORIGIN, ...(env.DEV_APP_ORIGIN ? [env.DEV_APP_ORIGIN] : [])];
  if (!origin || !allowlist.includes(origin)) {
    return { response: json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403) };
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken || accessToken.length > 8192 || !isBetterAuthTokenForIssuer(accessToken, env.BETTER_AUTH_URL)) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }
  try {
    const user = await resolveBetterAuthAdminIdentity({
      accessToken,
      authBaseUrl: env.BETTER_AUTH_URL,
      resourceAudience: env.SUPABASE_RESOURCE_AUDIENCE,
      supabaseUrl: env.SUPABASE_PROVISIONING_URL ?? "",
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    });
    return { user };
  } catch (error) {
    const code = error instanceof BetterAuthAdminAuthError ? error.code : "";
    if (code === "BETTER_AUTH_ADMIN_REQUIRED") {
      return { response: json({ ok: false, error: "ADMIN_REQUIRED" }, 403) };
    }
    if (
      code === "BETTER_AUTH_ADMIN_NOT_CONFIGURED" ||
      code === "BETTER_AUTH_ADMIN_PROJECT_NOT_ALLOWED" ||
      code === "BETTER_AUTH_ADMIN_CHECK_UNAVAILABLE" ||
      code === "BETTER_AUTH_ADMIN_CHECK_FAILED" ||
      code === "BETTER_AUTH_USERINFO_UNAVAILABLE" ||
      code === "BETTER_AUTH_ADMIN_CONFIGURATION_INVALID"
    ) {
      return { response: json({ ok: false, error: "ADMIN_AUTH_UNAVAILABLE" }, 503) };
    }
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }
}

async function listAdminSettings(env: AuthWorkerEnv): Promise<Response> {
  const meta = await readMeta(env.DB);
  if (!meta) return json({ ok: false, error: "SOCIAL_PROVIDER_SCHEMA_NOT_INSTALLED" }, 503);
  let rows: SocialProviderRow[];
  try {
    rows = await readRows(env.DB);
  } catch {
    return json({ ok: false, error: "SOCIAL_PROVIDER_SETTINGS_UNAVAILABLE" }, 503);
  }
  const configured = new Map(rows.map((row) => [row.provider, row]));
  const environment = meta.managed_mode === 1 ? {} : environmentProviders(env);
  const providers = SOCIAL_LOGIN_PROVIDERS.map((provider) => {
    const row = configured.get(provider);
    const envCredentials = environment[provider];
    const clientId = row?.client_id ?? envCredentials?.clientId ?? "";
    const secretConfigured = Boolean(row?.client_secret_ciphertext || envCredentials?.clientSecret);
    const decryptable = !row || !row.enabled || Boolean(env.AUTH_PROVIDER_ENCRYPTION_KEY && env.AUTH_PROVIDER_ENCRYPTION_KEY.length >= 32);
    return {
      provider,
      primary: provider === "google",
      enabled: meta.managed_mode === 1 ? row?.enabled === 1 && decryptable : Boolean(envCredentials),
      clientId,
      secretConfigured,
      source: meta.managed_mode === 1 ? (row ? "managed" : "not-configured") : (envCredentials ? "worker-secret" : "not-configured"),
      callbackUrl: callbackUrl(env, provider),
      status: row?.enabled === 1 && !decryptable ? "encryption-key-required" :
        secretConfigured ? "configured" : "not-configured",
      updatedAt: row?.updated_at ?? null,
    };
  });
  return json({
    ok: true,
    revision: meta.revision,
    managedMode: meta.managed_mode === 1,
    encryptionKeyConfigured: Boolean(env.AUTH_PROVIDER_ENCRYPTION_KEY && env.AUTH_PROVIDER_ENCRYPTION_KEY.length >= 32),
    providers,
    instagram: { available: false, reason: "Instagram consumer accounts are not supported as a general login provider." },
  });
}

async function seedEnvironmentProviders(
  env: AuthWorkerEnv,
  userId: string,
): Promise<void> {
  const key = env.AUTH_PROVIDER_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new Error("AUTH_PROVIDER_ENCRYPTION_KEY_NOT_CONFIGURED");
  const values = [
    ["google", env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    ["facebook", env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET],
    ["twitter", env.TWITTER_CLIENT_ID, env.TWITTER_CLIENT_SECRET],
  ] as const;
  const statements = [];
  for (const [provider, rawId, rawSecret] of values) {
    const clientId = rawId?.trim() ?? "";
    const clientSecret = rawSecret?.trim() ?? "";
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new Error("SOCIAL_PROVIDER_CREDENTIAL_PAIR_INVALID");
    }
    if (!clientId || !clientSecret) continue;
    const ciphertext = await encryptSocialProviderSecret(key, clientSecret);
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO auth_social_provider_settings " +
      "(provider, client_id, client_secret_ciphertext, enabled, created_by, updated_by) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    ).bind(provider, clientId, ciphertext, provider === "google" ? 1 : 0, userId));
  }
  if (statements.length) await env.DB.batch(statements);
}

async function bumpRevision(env: AuthWorkerEnv, userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE auth_social_provider_meta SET revision = revision + 1, managed_mode = 1, " +
    "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?1 WHERE id = 1",
  ).bind(userId).run();
}

async function saveProvider(
  body: Record<string, unknown>,
  user: { id: string; email: string },
  env: AuthWorkerEnv,
): Promise<Response> {
  const provider = body.provider;
  if (!isProvider(provider)) return json({ ok: false, error: "SOCIAL_PROVIDER_INVALID" }, 422);
  const key = env.AUTH_PROVIDER_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    return json({ ok: false, error: "SOCIAL_PROVIDER_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }
  const clientId = nonEmpty(body.clientId);
  if (!clientId || clientId.length > 512) return json({ ok: false, error: "SOCIAL_PROVIDER_CLIENT_ID_INVALID" }, 422);
  const suppliedSecret = nonEmpty(body.clientSecret);
  if (suppliedSecret.length > 4096) return json({ ok: false, error: "SOCIAL_PROVIDER_CLIENT_SECRET_INVALID" }, 422);

  const meta = await readMeta(env.DB);
  if (!meta) return json({ ok: false, error: "SOCIAL_PROVIDER_SCHEMA_NOT_INSTALLED" }, 503);
  if (meta.managed_mode !== 1) {
    try {
      await seedEnvironmentProviders(env, user.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return json({ ok: false, error: code === "AUTH_PROVIDER_ENCRYPTION_KEY_NOT_CONFIGURED"
        ? "SOCIAL_PROVIDER_ENCRYPTION_NOT_CONFIGURED"
        : "SOCIAL_PROVIDER_SETTINGS_MIGRATION_FAILED" }, 503);
    }
  }

  const existing = await env.DB.prepare(
    "SELECT provider, client_id, client_secret_ciphertext, enabled " +
    "FROM auth_social_provider_settings WHERE provider = ?1",
  ).bind(provider).first<Pick<SocialProviderRow, "provider" | "client_id" | "client_secret_ciphertext" | "enabled">>();
  if (!suppliedSecret && !existing) {
    return json({ ok: false, error: "SOCIAL_PROVIDER_CLIENT_SECRET_REQUIRED" }, 422);
  }
  if (!suppliedSecret && existing && existing.client_id !== clientId) {
    return json({ ok: false, error: "SOCIAL_PROVIDER_SECRET_REQUIRED_FOR_CLIENT_ID_CHANGE" }, 422);
  }

  let ciphertext = existing?.client_secret_ciphertext ?? "";
  if (suppliedSecret) {
    try {
      ciphertext = await encryptSocialProviderSecret(key, suppliedSecret);
    } catch {
      return json({ ok: false, error: "SOCIAL_PROVIDER_SECRET_ENCRYPTION_FAILED" }, 503);
    }
  }
  const enabled = typeof body.enabled === "boolean"
    ? body.enabled
    : existing ? existing.enabled === 1 : provider === "google";

  if (enabled !== (existing?.enabled === 1) || !existing) {
    const rows = await readRows(env.DB);
    const currentlyEnabled = rows.filter((row) => row.enabled === 1 && row.provider !== provider).length;
    if (!enabled && currentlyEnabled === 0 && rows.some((row) => row.enabled === 1)) {
      return json({ ok: false, error: "SOCIAL_PROVIDER_LAST_ENABLED_METHOD" }, 409);
    }
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO auth_social_provider_settings " +
        "(provider, client_id, client_secret_ciphertext, enabled, created_by, updated_by) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?5) " +
        "ON CONFLICT(provider) DO UPDATE SET client_id = excluded.client_id, " +
        "client_secret_ciphertext = excluded.client_secret_ciphertext, enabled = excluded.enabled, " +
        "updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      ).bind(provider, clientId, ciphertext, enabled ? 1 : 0, user.id),
      env.DB.prepare(
        "UPDATE auth_social_provider_meta SET revision = revision + 1, managed_mode = 1, " +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?1 WHERE id = 1",
      ).bind(user.id),
    ]);
  } catch {
    return json({ ok: false, error: "SOCIAL_PROVIDER_SAVE_FAILED" }, 503);
  }
  return listAdminSettings(env);
}

async function setProviderEnabled(
  body: Record<string, unknown>,
  user: { id: string; email: string },
  env: AuthWorkerEnv,
): Promise<Response> {
  const provider = body.provider;
  if (!isProvider(provider) || typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "SOCIAL_PROVIDER_TOGGLE_INVALID" }, 422);
  }
  const existing = await env.DB.prepare(
    "SELECT enabled, client_secret_ciphertext FROM auth_social_provider_settings WHERE provider = ?1",
  ).bind(provider).first<{ enabled: number; client_secret_ciphertext: string }>();
  if (!existing) return json({ ok: false, error: "SOCIAL_PROVIDER_NOT_CONFIGURED" }, 404);
  if (body.enabled && (!env.AUTH_PROVIDER_ENCRYPTION_KEY || env.AUTH_PROVIDER_ENCRYPTION_KEY.length < 32)) {
    return json({ ok: false, error: "SOCIAL_PROVIDER_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }
  if (!body.enabled && existing.enabled === 1) {
    const rows = await readRows(env.DB);
    if (rows.filter((row) => row.enabled === 1).length <= 1) {
      return json({ ok: false, error: "SOCIAL_PROVIDER_LAST_ENABLED_METHOD" }, 409);
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE auth_social_provider_settings SET enabled = ?1, updated_by = ?2, " +
      "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE provider = ?3",
    ).bind(body.enabled ? 1 : 0, user.id, provider),
    env.DB.prepare(
      "UPDATE auth_social_provider_meta SET revision = revision + 1, managed_mode = 1, " +
      "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?1 WHERE id = 1",
    ).bind(user.id),
  ]);
  return listAdminSettings(env);
}

async function validateProvider(
  body: Record<string, unknown>,
  env: AuthWorkerEnv,
): Promise<Response> {
  const provider = body.provider;
  if (!isProvider(provider)) return json({ ok: false, error: "SOCIAL_PROVIDER_INVALID" }, 422);
  const row = await env.DB.prepare(
    "SELECT client_id, client_secret_ciphertext, enabled FROM auth_social_provider_settings WHERE provider = ?1",
  ).bind(provider).first<{ client_id: string; client_secret_ciphertext: string; enabled: number }>();
  if (!row) return json({ ok: false, error: "SOCIAL_PROVIDER_NOT_CONFIGURED" }, 404);
  if (!env.AUTH_PROVIDER_ENCRYPTION_KEY || env.AUTH_PROVIDER_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "SOCIAL_PROVIDER_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }
  try {
    const secret = await decryptSocialProviderSecret(env.AUTH_PROVIDER_ENCRYPTION_KEY, row.client_secret_ciphertext);
    if (!row.client_id.trim() || !secret.trim()) throw new Error("invalid");
  } catch {
    return json({ ok: false, error: "SOCIAL_PROVIDER_CREDENTIAL_DECRYPT_FAILED" }, 422);
  }
  return json({
    ok: true,
    provider,
    enabled: row.enabled === 1,
    status: "local-configuration-valid",
    hostedSignInRequired: true,
    message: "Kredensial terenkripsi dapat dibaca Worker. Ini belum menguji koneksi OAuth ke penyedia.",
  });
}

export async function getPublicSocialLoginProviders(env: AuthWorkerEnv): Promise<Response> {
  const config = await readSocialProviderConfiguration(env);
  const availableProviders = SOCIAL_LOGIN_PROVIDERS.filter((provider) => Boolean(config.providers[provider]));
  return json({
    ok: true,
    providers: availableProviders,
    issuer: new URL(env.BETTER_AUTH_URL).origin + "/api/auth",
  });
}

export async function handleLoginProviderAdminRequest(request: Request, env: AuthWorkerEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  const authorization = await requireBetterAuthAdmin(request, env);
  if ("response" in authorization) return authorization.response;
  if (request.method === "GET") return listAdminSettings(env);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const record = body as Record<string, unknown>;
  const action = nonEmpty(record.action);
  if (action === "save") return saveProvider(record, authorization.user, env);
  if (action === "set-enabled") return setProviderEnabled(record, authorization.user, env);
  if (action === "validate") return validateProvider(record, env);
  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
}

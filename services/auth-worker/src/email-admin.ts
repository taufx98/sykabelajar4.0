import type { AuthWorkerEnv } from "./env";
import { decryptEmailSecret, encryptEmailSecret } from "./email-secret.mjs";
import { isAllowedOrigin } from "./security.mjs";
import { getEmailAdminAllowedOrigins } from "./cors-origins.mjs";
import { EmailProviderDeliveryError, normalizeCustomHttpConfig, sendEmailWithProvider } from "./email-providers.mjs";
import {
  BetterAuthAdminAuthError,
  isBetterAuthTokenForIssuer,
  resolveBetterAuthAdminIdentity,
} from "./email-admin-auth.mjs";
import { readEmailVerificationPolicy } from "./auth-runtime-settings";

type SupabaseAdminUser = { id: string; email: string };
type EmailProvider = "sendpulse" | "brevo" | "mailjet" | "mailtrap" | "resend" | "custom_http";
type EmailAccountRow = {
  id: string;
  label: string;
  provider: EmailProvider;
  sender_address: string;
  sender_name: string;
  endpoint_url: string | null;
  auth_mode: string | null;
  credentials_ciphertext: string;
  quota_hour_limit: number;
  quota_day_limit: number;
  quota_month_limit: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};
type PublicEmailAccount = {
  id: string;
  label: string;
  provider: EmailProvider;
  senderAddress: string;
  senderName: string;
  endpointUrl: string | null;
  authMode: string | null;
  credentialConfigured: boolean;
  enabled: boolean;
  priority: number;
  quotaHourLimit: number;
  quotaDayLimit: number;
  quotaMonthLimit: number;
  hourUsed: number;
  dayUsed: number;
  monthUsed: number;
  cooldownUntil: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSendMailToken(value: string): string {
  return value.replace(/^Zoho-enczapikey\s+/i, "").trim();
}

function supabaseBaseUrl(env: AuthWorkerEnv): string | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function requireActiveAdmin(request: Request, env: AuthWorkerEnv): Promise<
  { user: SupabaseAdminUser } | { response: Response }
> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, getEmailAdminAllowedOrigins(env))) {
    return { response: json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403) };
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken || accessToken.length > 8192) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  // Better Auth resource tokens are third-party OIDC JWTs, not Supabase Auth
  // access tokens. Route them through the pinned issuer/JWKS + UserInfo verifier.
  // Admin membership is checked only against the exact environment-pinned
  // Supabase identity project; the legacy Supabase Auth path below continues
  // to use the separately configured legacy Supabase URL.
  if (env.BETTER_AUTH_URL && isBetterAuthTokenForIssuer(accessToken, env.BETTER_AUTH_URL)) {
    try {
      const user = await resolveBetterAuthAdminIdentity({
        accessToken,
        authBaseUrl: env.BETTER_AUTH_URL,
        resourceAudience: env.SUPABASE_RESOURCE_AUDIENCE,
        supabaseUrl: env.SUPABASE_PROVISIONING_URL ?? "",
        supabaseEnvironment: env.SUPABASE_PROVISIONING_ENV ?? "staging",
        publishableKey: env.SUPABASE_PROVISIONING_PUBLISHABLE_KEY ?? "",
        allowUnverifiedEmail: !(await readEmailVerificationPolicy(env)),
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

  // Legacy Supabase Auth path remains unchanged.
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl) {
    return { response: json({ ok: false, error: "ADMIN_AUTH_NOT_CONFIGURED" }, 503) };
  }

  let authResponse: Response;
  try {
    authResponse = await fetch(baseUrl + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + accessToken,
      },
    });
  } catch {
    return { response: json({ ok: false, error: "ADMIN_AUTH_UNAVAILABLE" }, 503) };
  }
  if (!authResponse.ok) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  const user = await authResponse.json().catch(() => null) as Record<string, unknown> | null;
  const userId = nonEmpty(user?.id);
  const email = nonEmpty(user?.email);
  if (!userId || !validEmail(email)) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  let roleResponse: Response;
  try {
    roleResponse = await fetch(baseUrl + "/rest/v1/rpc/is_active_admin", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_uid: userId }),
    });
  } catch {
    return { response: json({ ok: false, error: "ADMIN_CHECK_UNAVAILABLE" }, 503) };
  }
  if (!roleResponse.ok) {
    return { response: json({ ok: false, error: "ADMIN_CHECK_FAILED" }, 503) };
  }
  const isAdmin = await roleResponse.json().catch(() => false);
  if (isAdmin !== true) {
    return { response: json({ ok: false, error: "ADMIN_REQUIRED" }, 403) };
  }
  return { user: { id: userId, email } };
}


const PROVIDERS = ["sendpulse", "brevo", "mailjet", "mailtrap", "resend", "custom_http"] as const;
const DEFAULT_QUOTAS: Record<EmailProvider, { hour: number; day: number; month: number }> = {
  sendpulse: { hour: 50, day: 400, month: 0 },
  brevo: { hour: 0, day: 300, month: 0 },
  mailjet: { hour: 0, day: 200, month: 6000 },
  mailtrap: { hour: 0, day: 150, month: 4000 },
  resend: { hour: 0, day: 100, month: 3000 },
  custom_http: { hour: 0, day: 0, month: 0 },
};

function providerName(provider: EmailProvider): string {
  return ({ sendpulse: "SendPulse", brevo: "Brevo", mailjet: "Mailjet", mailtrap: "Mailtrap", resend: "Resend", custom_http: "Custom HTTP" })[provider];
}

function parseCredentials(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("EMAIL_CREDENTIALS_INVALID");
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof item === "string") output[key] = item;
  }
  return output;
}

function normalizeCredentials(provider: EmailProvider, raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const values: Record<string, string> = {};
  const keys = provider === "mailjet"
    ? ["apiKey", "apiSecret"]
    : provider === "mailtrap"
      ? ["apiToken"]
      : ["apiKey"];
  for (const key of keys) {
    const value = nonEmpty(input[key]);
    if (!value || value.length < 16 || value.length > 4096) return null;
    values[key] = value;
  }
  return values;
}

function quotaValue(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
}


function isPinnedStagingEmailPolicyTarget(env: AuthWorkerEnv): boolean {
  if (env.SUPABASE_PROVISIONING_ENV !== "staging") return false;
  try {
    return new URL(env.SUPABASE_PROVISIONING_URL ?? "").origin ===
      "https://ydamszdfsxqisanazdkb.supabase.co";
  } catch {
    return false;
  }
}

async function getEmailVerificationPolicy(env: AuthWorkerEnv): Promise<Response> {
  if (!isPinnedStagingEmailPolicyTarget(env)) {
    return json({ ok: false, error: "STAGING_EMAIL_VERIFICATION_SETTINGS_ONLY" }, 403);
  }
  try {
    const row = await env.DB.prepare(
      "SELECT email_verification_required, updated_at, updated_by " +
      "FROM auth_runtime_settings WHERE id = 1",
    ).first<{ email_verification_required: number; updated_at: string; updated_by: string }>();
    if (!row) return json({ ok: false, error: "AUTH_RUNTIME_SETTINGS_NOT_MIGRATED" }, 503);
    return json({
      ok: true,
      emailVerificationRequired: row.email_verification_required === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    });
  } catch {
    return json({ ok: false, error: "AUTH_RUNTIME_SETTINGS_UNAVAILABLE" }, 503);
  }
}

async function setEmailVerificationPolicy(
  body: Record<string, unknown>,
  user: SupabaseAdminUser,
  env: AuthWorkerEnv,
): Promise<Response> {
  if (typeof body.emailVerificationRequired !== "boolean") {
    return json({ ok: false, error: "EMAIL_VERIFICATION_POLICY_INVALID" }, 422);
  }
  if (!isPinnedStagingEmailPolicyTarget(env)) {
    return json({ ok: false, error: "STAGING_EMAIL_VERIFICATION_SETTINGS_ONLY" }, 403);
  }
  try {
    const result = await env.DB.prepare(
      "UPDATE auth_runtime_settings SET email_verification_required=?1, " +
      "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=?2 WHERE id=1",
    ).bind(body.emailVerificationRequired ? 1 : 0, user.id).run();
    if (!result.success || result.meta.changes !== 1) {
      return json({ ok: false, error: "AUTH_RUNTIME_SETTINGS_SAVE_FAILED" }, 503);
    }
    return getEmailVerificationPolicy(env);
  } catch {
    return json({ ok: false, error: "AUTH_RUNTIME_SETTINGS_SAVE_FAILED" }, 503);
  }
}

async function listSettings(env: AuthWorkerEnv): Promise<Response> {
  const [settings, accounts] = await Promise.all([
    env.DB.prepare(
      "SELECT auto_failover_enabled FROM auth_email_provider_settings WHERE id = 1",
    ).first<{ auto_failover_enabled: number }>(),
    env.DB.prepare(
      "SELECT id, label, provider, sender_address, sender_name, endpoint_url, auth_mode, " +
      "CASE WHEN length(credentials_ciphertext) > 0 THEN 1 ELSE 0 END AS credential_configured, " +
      "enabled, priority, quota_hour_limit, quota_day_limit, quota_month_limit, " +
      "CASE WHEN hour_bucket = strftime('%Y%m%d%H','now') THEN hour_used ELSE 0 END AS hour_used, " +
      "CASE WHEN day_bucket = strftime('%Y%m%d','now') THEN day_used ELSE 0 END AS day_used, " +
      "CASE WHEN month_bucket = strftime('%Y%m','now') THEN month_used ELSE 0 END AS month_used, " +
      "cooldown_until, last_error_code, last_error_at, last_success_at, created_at, updated_at " +
      "FROM auth_email_provider_accounts ORDER BY priority ASC, created_at ASC",
    ).all<{
      id: string; label: string; provider: EmailProvider; sender_address: string; sender_name: string;
      endpoint_url: string | null; auth_mode: string | null; credential_configured: number; enabled: number; priority: number;
      quota_hour_limit: number; quota_day_limit: number; quota_month_limit: number;
      hour_used: number; day_used: number; month_used: number;
      cooldown_until: string | null; last_error_code: string | null; last_error_at: string | null;
      last_success_at: string | null; created_at: string; updated_at: string;
    }>(),
  ]);
  const firstEnabledId = (accounts.results ?? []).find((row) => row.enabled === 1)?.id ?? null;
  const safeAccounts: PublicEmailAccount[] = (accounts.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    provider: row.provider,
    senderAddress: row.sender_address,
    senderName: row.sender_name,
    endpointUrl: row.endpoint_url,
    authMode: row.auth_mode,
    credentialConfigured: row.credential_configured === 1,
    enabled: row.enabled === 1,
    priority: row.priority,
    quotaHourLimit: row.quota_hour_limit,
    quotaDayLimit: row.quota_day_limit,
    quotaMonthLimit: row.quota_month_limit,
    hourUsed: row.hour_used,
    dayUsed: row.day_used,
    monthUsed: row.month_used,
    cooldownUntil: row.cooldown_until,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: row.id === firstEnabledId,
  }));
  return json({
    ok: true,
    emailVerificationPolicyAvailable: isPinnedStagingEmailPolicyTarget(env),
    autoFailoverEnabled: settings?.auto_failover_enabled !== 0,
    accounts: safeAccounts,
  });
}

async function saveAccount(body: Record<string, unknown>, user: SupabaseAdminUser, env: AuthWorkerEnv): Promise<Response> {
  const id = nonEmpty(body.id) || crypto.randomUUID();
  const label = nonEmpty(body.label);
  const provider = nonEmpty(body.provider) as EmailProvider;
  const senderAddress = nonEmpty(body.senderAddress).toLowerCase();
  const senderName = nonEmpty(body.senderName) || "SYKABELAJAR";

  if (!PROVIDERS.includes(provider)) return json({ ok: false, error: "INVALID_EMAIL_PROVIDER" }, 422);
  if (!label || label.length > 80) return json({ ok: false, error: "INVALID_ACCOUNT_LABEL" }, 422);
  if (!validEmail(senderAddress)) return json({ ok: false, error: "INVALID_SENDER_ADDRESS" }, 422);
  if (senderName.length > 120) return json({ ok: false, error: "INVALID_SENDER_NAME" }, 422);
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "EMAIL_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }

  const existing = await env.DB.prepare(
    "SELECT id, provider, credentials_ciphertext, endpoint_url, auth_mode, priority, quota_hour_limit, quota_day_limit, quota_month_limit " +
    "FROM auth_email_provider_accounts WHERE id = ?1",
  ).bind(id).first<{
    id: string; provider: EmailProvider; credentials_ciphertext: string; endpoint_url: string | null;
    auth_mode: string | null; priority: number; quota_hour_limit: number;
    quota_day_limit: number; quota_month_limit: number;
  }>();
  if (body.id && !existing) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);

  let credentials: Record<string, string> | null = null;
  let ciphertext = existing?.credentials_ciphertext ?? "";
  let endpointUrl: string | null = null;
  let authMode: string | null = null;

  if (provider === "custom_http") {
    let previous: Record<string, string> = {};
    if (existing?.provider === "custom_http" && existing.credentials_ciphertext) {
      try {
        previous = parseCredentials(await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, existing.credentials_ciphertext));
      } catch {
        return json({ ok: false, error: "EMAIL_ACCOUNT_SECRET_UNAVAILABLE" }, 503);
      }
    }
    const rawConfig = body.customConfig && typeof body.customConfig === "object" &&
      !Array.isArray(body.customConfig) ? body.customConfig as Record<string, unknown> : {};
    const merged: Record<string, string> = { ...previous };
    for (const key of [
      "endpointUrl", "authMode", "authHeaderName", "authPrefix",
      "apiKey", "username", "password", "extraHeadersJson", "payloadTemplateJson",
    ]) {
      if (typeof rawConfig[key] === "string" && (rawConfig[key] as string).trim()) {
        merged[key] = (rawConfig[key] as string).trim();
      }
    }
    try {
      credentials = normalizeCustomHttpConfig(merged);
      endpointUrl = credentials.endpointUrl;
      authMode = credentials.authMode;
      ciphertext = await encryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, JSON.stringify(credentials));
    } catch (error) {
      const code = error instanceof Error && /^EMAIL_CUSTOM_/.test(error.message)
        ? error.message : "EMAIL_PROVIDER_CREDENTIAL_REQUIRED";
      return json({ ok: false, error: code }, 422);
    }
  } else {
    credentials = normalizeCredentials(provider, body.credentials);
    if (Object.hasOwn(body, "credentials") && !credentials) {
      return json({ ok: false, error: "INVALID_EMAIL_PROVIDER_CREDENTIAL" }, 422);
    }
    if (credentials) {
      try {
        ciphertext = await encryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, JSON.stringify(credentials));
      } catch {
        return json({ ok: false, error: "EMAIL_SECRET_ENCRYPTION_FAILED" }, 503);
      }
    } else {
      if (!existing || existing.provider !== provider || !existing.credentials_ciphertext) {
        return json({ ok: false, error: "EMAIL_PROVIDER_CREDENTIAL_REQUIRED" }, 422);
      }
      try {
        const plaintext = await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, existing.credentials_ciphertext);
        credentials = parseCredentials(plaintext);
      } catch {
        return json({ ok: false, error: "EMAIL_ACCOUNT_SECRET_UNAVAILABLE" }, 503);
      }
    }
  }

  const defaults = DEFAULT_QUOTAS[provider];
  const hour = quotaValue(body.quotaHourLimit, existing?.quota_hour_limit ?? defaults.hour);
  const day = quotaValue(body.quotaDayLimit, existing?.quota_day_limit ?? defaults.day);
  const month = quotaValue(body.quotaMonthLimit, existing?.quota_month_limit ?? defaults.month);
  const priority = quotaValue(body.priority, existing?.priority ?? 100);
  if (hour === null || day === null || month === null || priority === null) {
    return json({ ok: false, error: "INVALID_EMAIL_QUOTA" }, 422);
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO auth_email_provider_accounts " +
    "(id,label,provider,sender_address,sender_name,endpoint_url,auth_mode,credentials_ciphertext,enabled,priority,quota_hour_limit,quota_day_limit,quota_month_limit,created_at,updated_at,created_by,updated_by) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13,?13,?14,?14) " +
    "ON CONFLICT(id) DO UPDATE SET label=excluded.label,provider=excluded.provider,sender_address=excluded.sender_address," +
    "sender_name=excluded.sender_name,endpoint_url=excluded.endpoint_url,auth_mode=excluded.auth_mode," +
    "credentials_ciphertext=excluded.credentials_ciphertext,priority=excluded.priority," +
    "quota_hour_limit=excluded.quota_hour_limit,quota_day_limit=excluded.quota_day_limit,quota_month_limit=excluded.quota_month_limit," +
    "last_error_code=CASE WHEN auth_email_provider_accounts.provider <> excluded.provider THEN NULL ELSE auth_email_provider_accounts.last_error_code END," +
    "cooldown_until=CASE WHEN auth_email_provider_accounts.provider <> excluded.provider THEN NULL ELSE auth_email_provider_accounts.cooldown_until END," +
    "updated_at=excluded.updated_at,updated_by=excluded.updated_by",
  ).bind(id,label,provider,senderAddress,senderName,endpointUrl,authMode,ciphertext,priority,hour,day,month,now,user.id).run();
  if (!result.success) return json({ ok: false, error: "EMAIL_ACCOUNT_SAVE_FAILED" }, 500);
  return listSettings(env);
}

async function configureRouting(body: Record<string, unknown>, user: SupabaseAdminUser, env: AuthWorkerEnv): Promise<Response> {
  if (typeof body.autoFailoverEnabled !== "boolean" || !Array.isArray(body.accounts) || body.accounts.length > 20) {
    return json({ ok: false, error: "EMAIL_ROUTING_CONFIGURATION_INVALID" }, 422);
  }
  const statements = [
    env.DB.prepare(
      "UPDATE auth_email_provider_settings SET auto_failover_enabled=?1,updated_at=?2,updated_by=?3 WHERE id=1",
    ).bind(body.autoFailoverEnabled ? 1 : 0, new Date().toISOString(), user.id),
  ];
  for (const item of body.accounts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return json({ ok: false, error: "EMAIL_ROUTING_CONFIGURATION_INVALID" }, 422);
    const route = item as Record<string, unknown>;
    const id = nonEmpty(route.id);
    const enabled = route.enabled;
    const priority = quotaValue(route.priority, -1);
    const hour = quotaValue(route.quotaHourLimit, -1);
    const day = quotaValue(route.quotaDayLimit, -1);
    const month = quotaValue(route.quotaMonthLimit, -1);
    if (!id || typeof enabled !== "boolean" || priority === null || priority < 0 || hour === null || day === null || month === null) {
      return json({ ok: false, error: "EMAIL_ROUTING_CONFIGURATION_INVALID" }, 422);
    }
    statements.push(env.DB.prepare(
      "UPDATE auth_email_provider_accounts SET enabled=?1,priority=?2,quota_hour_limit=?3,quota_day_limit=?4,quota_month_limit=?5,updated_at=?6,updated_by=?7 WHERE id=?8",
    ).bind(enabled ? 1 : 0,priority,hour,day,month,new Date().toISOString(),user.id,id));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    return json({ ok: false, error: "EMAIL_ROUTING_SAVE_FAILED" }, 503);
  }
  return listSettings(env);
}

async function deleteAccount(body: Record<string, unknown>, env: AuthWorkerEnv): Promise<Response> {
  const id = nonEmpty(body.id);
  if (!id) return json({ ok: false, error: "EMAIL_ACCOUNT_REQUIRED" }, 422);
  const result = await env.DB.prepare("DELETE FROM auth_email_provider_accounts WHERE id=?1").bind(id).run();
  if (!result.success || result.meta.changes !== 1) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);
  return listSettings(env);
}

async function reserveTestQuota(env: AuthWorkerEnv, accountId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "UPDATE auth_email_provider_accounts SET " +
    "hour_used=CASE WHEN hour_bucket <> strftime('%Y%m%d%H','now') THEN 1 ELSE hour_used+1 END,hour_bucket=strftime('%Y%m%d%H','now')," +
    "day_used=CASE WHEN day_bucket <> strftime('%Y%m%d','now') THEN 1 ELSE day_used+1 END,day_bucket=strftime('%Y%m%d','now')," +
    "month_used=CASE WHEN month_bucket <> strftime('%Y%m','now') THEN 1 ELSE month_used+1 END,month_bucket=strftime('%Y%m','now')," +
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND enabled=1 " +
    "AND (quota_hour_limit=0 OR (CASE WHEN hour_bucket <> strftime('%Y%m%d%H','now') THEN 0 ELSE hour_used END)<quota_hour_limit) " +
    "AND (quota_day_limit=0 OR (CASE WHEN day_bucket <> strftime('%Y%m%d','now') THEN 0 ELSE day_used END)<quota_day_limit) " +
    "AND (quota_month_limit=0 OR (CASE WHEN month_bucket <> strftime('%Y%m','now') THEN 0 ELSE month_used END)<quota_month_limit) RETURNING id",
  ).bind(accountId).first<{id:string}>();
  return Boolean(row?.id);
}

async function testAccount(body: Record<string, unknown>, user: SupabaseAdminUser, env: AuthWorkerEnv): Promise<Response> {
  const id = nonEmpty(body.id);
  if (!id) return json({ ok: false, error: "EMAIL_ACCOUNT_REQUIRED" }, 422);
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "EMAIL_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }
  const account = await env.DB.prepare(
    "SELECT id,provider,sender_address,sender_name,credentials_ciphertext FROM auth_email_provider_accounts WHERE id=?1",
  ).bind(id).first<{id:string;provider:EmailProvider;sender_address:string;sender_name:string;credentials_ciphertext:string}>();
  if (!account) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);

  const now = Math.floor(Date.now()/1000);
  const limit = await env.DB.prepare(
    "INSERT INTO auth_email_admin_test_limits (user_id,last_sent_at) VALUES (?1,?2) " +
    "ON CONFLICT(user_id) DO UPDATE SET last_sent_at=excluded.last_sent_at " +
    "WHERE auth_email_admin_test_limits.last_sent_at <= ?3 RETURNING user_id",
  ).bind(user.id,now,now-60).first<{user_id:string}>();
  if (!limit) return json({ ok: false, error: "EMAIL_TEST_RATE_LIMITED" }, 429);
  if (!(await reserveTestQuota(env,id))) return json({ ok: false, error: "EMAIL_PROVIDER_QUOTA_REACHED" }, 429);

  try {
    const plaintext = await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY,account.credentials_ciphertext);
    const credentials = parseCredentials(plaintext);
    const sent = await sendEmailWithProvider(account.provider,credentials,{
      senderAddress:account.sender_address,senderName:account.sender_name,
    },{
      to:user.email,subject:"Tes pengiriman email SYKABELAJAR",
      text:"Ini adalah email tes dari pengaturan email transaksional SYKABELAJAR.",
      action:"admin-test",
    });
    await env.DB.prepare(
      "UPDATE auth_email_provider_accounts SET last_success_at=?1,last_error_code=NULL,last_error_at=NULL,cooldown_until=NULL,updated_at=?1 WHERE id=?2",
    ).bind(new Date().toISOString(),id).run();
    return json({ok:true,message:"Email tes "+providerName(account.provider)+" dikirim hanya ke email admin yang sedang login.",requestId:sent.messageId});
  } catch (error) {
    const code = error instanceof EmailProviderDeliveryError ? error.code : "EMAIL_PROVIDER_TEST_FAILED";
    const cooldown = error instanceof EmailProviderDeliveryError ? error.cooldownSeconds : 0;
    const until = cooldown > 0 ? new Date(Date.now()+cooldown*1000).toISOString() : null;
    await env.DB.prepare(
      "UPDATE auth_email_provider_accounts SET last_error_code=?1,last_error_at=?2,cooldown_until=?3,updated_at=?2 WHERE id=?4",
    ).bind(code,new Date().toISOString(),until,id).run();
    if (code === "EMAIL_PROVIDER_CREDENTIAL_REJECTED") return json({ok:false,error:"EMAIL_PROVIDER_CREDENTIAL_REJECTED"},422);
    if (code === "EMAIL_PROVIDER_QUOTA_REACHED") return json({ok:false,error:"EMAIL_PROVIDER_QUOTA_REACHED"},429);
    if (code === "EMAIL_DELIVERY_STATUS_UNKNOWN") return json({ok:false,error:code},502);
    return json({ok:false,error:"EMAIL_PROVIDER_TEST_FAILED"},502);
  }
}

export async function handleEmailAdminRequest(request: Request, env: AuthWorkerEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  const authorization = await requireActiveAdmin(request, env);
  if ("response" in authorization) return authorization.response;
  if (request.method === "GET") return listSettings(env);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const record = body as Record<string, unknown>;
  const action = nonEmpty(record.action);
  if (action === "get-verification-policy") return getEmailVerificationPolicy(env);
  if (action === "set-verification-policy") return setEmailVerificationPolicy(record, authorization.user, env);
  if (action === "save") return saveAccount(record, authorization.user, env);
  if (action === "configure") return configureRouting(record, authorization.user, env);
  if (action === "delete") return deleteAccount(record, env);
  if (action === "test") return testAccount(record, authorization.user, env);
  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
}

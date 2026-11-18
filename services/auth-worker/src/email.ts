import { decryptEmailSecret } from "./email-secret.mjs";
import { deliverAuthEmail, isEmailDeliveryConfigured } from "./email-delivery.mjs";
import { EmailProviderDeliveryError, normalizeCustomHttpConfig, sendEmailWithProvider } from "./email-providers.mjs";
import type { AuthWorkerEnv } from "./env";

type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
  action: "verify-email" | "verify-email-otp" | "reset-password" | "admin-test";
};

type EmailProvider = "sendpulse" | "brevo" | "mailjet" | "mailtrap" | "resend" | "zeptomail" | "custom_http";
type ProviderAccount = {
  id: string;
  provider: EmailProvider;
  sender_address: string;
  sender_name: string;
  credentials_ciphertext: string;
  quota_hour_limit: number;
  quota_day_limit: number;
  quota_month_limit: number;
};

/** A UTC bucket is calculated inside D1 so concurrent Worker isolates share the same limits. */
async function reserveProviderQuota(env: AuthWorkerEnv, account: ProviderAccount): Promise<boolean> {
  const row = await env.DB.prepare(
    "UPDATE auth_email_provider_accounts SET " +
    "hour_used = CASE WHEN hour_bucket <> strftime('%Y%m%d%H','now') THEN 1 ELSE hour_used + 1 END, " +
    "hour_bucket = strftime('%Y%m%d%H','now'), " +
    "day_used = CASE WHEN day_bucket <> strftime('%Y%m%d','now') THEN 1 ELSE day_used + 1 END, " +
    "day_bucket = strftime('%Y%m%d','now'), " +
    "month_used = CASE WHEN month_bucket <> strftime('%Y%m','now') THEN 1 ELSE month_used + 1 END, " +
    "month_bucket = strftime('%Y%m','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
    "WHERE id = ?1 AND enabled = 1 " +
    "AND (cooldown_until IS NULL OR cooldown_until <= strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
    "AND (quota_hour_limit = 0 OR (CASE WHEN hour_bucket <> strftime('%Y%m%d%H','now') THEN 0 ELSE hour_used END) < quota_hour_limit) " +
    "AND (quota_day_limit = 0 OR (CASE WHEN day_bucket <> strftime('%Y%m%d','now') THEN 0 ELSE day_used END) < quota_day_limit) " +
    "AND (quota_month_limit = 0 OR (CASE WHEN month_bucket <> strftime('%Y%m','now') THEN 0 ELSE month_used END) < quota_month_limit) " +
    "RETURNING id",
  ).bind(account.id).first<{ id: string }>();
  return Boolean(row?.id);
}

async function recordProviderError(
  env: AuthWorkerEnv,
  accountId: string,
  code: string,
  cooldownSeconds = 0,
): Promise<void> {
  const until = cooldownSeconds > 0
    ? new Date(Date.now() + cooldownSeconds * 1000).toISOString()
    : null;
  await env.DB.prepare(
    "UPDATE auth_email_provider_accounts SET last_error_code = ?1, last_error_at = ?2, " +
    "cooldown_until = ?3, updated_at = ?2 WHERE id = ?4",
  ).bind(code, new Date().toISOString(), until, accountId).run();
}

async function recordProviderSuccess(env: AuthWorkerEnv, accountId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE auth_email_provider_accounts SET last_error_code = NULL, last_error_at = NULL, " +
    "cooldown_until = NULL, last_success_at = ?1, updated_at = ?1 WHERE id = ?2",
  ).bind(new Date().toISOString(), accountId).run();
}

function parseCredentials(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("EMAIL_CREDENTIALS_INVALID");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

function hasRequiredProviderCredentials(provider: EmailProvider, credentials: Record<string, string>): boolean {
  const usable = (value: string | undefined) => typeof value === "string" && value.trim().length >= 16;
  if (provider === "custom_http") {
    try { normalizeCustomHttpConfig(credentials); return true; } catch { return false; }
  }
  if (provider === "mailjet") return usable(credentials.apiKey) && usable(credentials.apiSecret);
  if (provider === "mailtrap") return usable(credentials.apiToken);
  return usable(credentials.apiKey);
}

/**
 * This function only returns true when at least one enabled provider has a
 * decryptable credential. It never sends mail or trusts stale Admin metadata.
 */
export async function isAuthEmailVerificationConfigured(env: AuthWorkerEnv): Promise<boolean> {
  const providerMode = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();
  if (providerMode === "webhook") return isEmailDeliveryConfigured(env);
  if (providerMode !== "managed") return false;
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) return false;

  try {
    const accounts = await env.DB.prepare(
      "SELECT provider, sender_address, sender_name, credentials_ciphertext, " +
      "quota_hour_limit, quota_day_limit, quota_month_limit, " +
      "CASE WHEN hour_bucket = strftime('%Y%m%d%H','now') THEN hour_used ELSE 0 END AS hour_used, " +
      "CASE WHEN day_bucket = strftime('%Y%m%d','now') THEN day_used ELSE 0 END AS day_used, " +
      "CASE WHEN month_bucket = strftime('%Y%m','now') THEN month_used ELSE 0 END AS month_used, " +
      "cooldown_until " +
      "FROM auth_email_provider_accounts WHERE enabled = 1 ORDER BY priority ASC, created_at ASC",
    ).all<Pick<ProviderAccount,
      "provider" | "sender_address" | "sender_name" | "credentials_ciphertext" |
      "quota_hour_limit" | "quota_day_limit" | "quota_month_limit"
    > & { hour_used: number; day_used: number; month_used: number; cooldown_until: string | null }>();
    for (const account of accounts.results ?? []) {
      if (!account.sender_address?.trim() || !account.sender_name?.trim()) continue;
      if (account.cooldown_until && Date.parse(account.cooldown_until) > Date.now()) continue;
      if (account.quota_hour_limit > 0 && account.hour_used >= account.quota_hour_limit) continue;
      if (account.quota_day_limit > 0 && account.day_used >= account.quota_day_limit) continue;
      if (account.quota_month_limit > 0 && account.month_used >= account.quota_month_limit) continue;
      try {
        const plaintext = await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, account.credentials_ciphertext);
        const credentials = parseCredentials(plaintext);
        if (hasRequiredProviderCredentials(account.provider, credentials)) return true;
      } catch {
        // A broken profile is not a usable provider; check the next enabled one.
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function sendManagedEmail(env: AuthWorkerEnv, message: AuthEmailMessage): Promise<void> {
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    throw new Error("AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  const settings = await env.DB.prepare(
    "SELECT auto_failover_enabled FROM auth_email_provider_settings WHERE id = 1",
  ).first<{ auto_failover_enabled: number }>();
  const autoFailover = settings?.auto_failover_enabled !== 0;
  const result = await env.DB.prepare(
    "SELECT id, provider, sender_address, sender_name, credentials_ciphertext, " +
    "quota_hour_limit, quota_day_limit, quota_month_limit " +
    "FROM auth_email_provider_accounts WHERE enabled = 1 " +
    "ORDER BY priority ASC, created_at ASC",
  ).all<ProviderAccount>();
  const accounts = result.results ?? [];
  if (accounts.length === 0) throw new Error("AUTH_EMAIL_ALL_PROVIDERS_EXHAUSTED");

  const candidates = autoFailover ? accounts : accounts.slice(0, 1);
  let lastSafeError = "AUTH_EMAIL_ALL_PROVIDERS_EXHAUSTED";
  let attempted = 0;

  for (const account of candidates) {
    const reserved = await reserveProviderQuota(env, account);
    if (!reserved) {
      lastSafeError = "AUTH_EMAIL_PROVIDER_QUOTA_REACHED";
      continue;
    }
    attempted += 1;

    let credentials: Record<string, string>;
    try {
      const plaintext = await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, account.credentials_ciphertext);
      credentials = parseCredentials(plaintext);
    } catch {
      await recordProviderError(env, account.id, "EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE", 3600);
      lastSafeError = "AUTH_EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE";
      if (autoFailover) continue;
      throw new Error(lastSafeError);
    }

    try {
      await sendEmailWithProvider(account.provider, credentials, {
        senderAddress: account.sender_address,
        senderName: account.sender_name,
      }, message);
      await recordProviderSuccess(env, account.id);
      return;
    } catch (error) {
      if (error instanceof EmailProviderDeliveryError) {
        await recordProviderError(
          env,
          account.id,
          error.code,
          error.allowFailover ? error.cooldownSeconds : 0,
        );
        lastSafeError = error.code;
        if (autoFailover && error.allowFailover) continue;
        // Timeout, network failure and provider 5xx are ambiguous. Stop here:
        // another provider could send a duplicate if the first accepted it.
        throw new Error(error.allowFailover ? error.code : "AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN");
      }
      await recordProviderError(env, account.id, "EMAIL_PROVIDER_UNEXPECTED_ERROR");
      throw new Error("AUTH_EMAIL_DELIVERY_FAILED");
    }
  }

  if (attempted === 0) throw new Error("AUTH_EMAIL_ALL_PROVIDERS_EXHAUSTED");
  throw new Error(lastSafeError);
}

export async function sendAuthEmail(
  env: AuthWorkerEnv,
  message: AuthEmailMessage,
): Promise<void> {
  const providerMode = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();
  if (providerMode === "managed") return sendManagedEmail(env, message);
  if (providerMode !== "webhook") throw new Error("AUTH_EMAIL_PROVIDER_UNSUPPORTED");
  await deliverAuthEmail(env, message);
}

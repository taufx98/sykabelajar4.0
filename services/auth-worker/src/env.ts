export interface AuthWorkerEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ORIGIN: string;
  SUPABASE_RESOURCE_AUDIENCE: string;
  /** Optional social login credentials; unset keeps that provider disabled. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  /** Dedicated AES-GCM key for managed social OAuth client secrets; never reuse the email key. */
  AUTH_PROVIDER_ENCRYPTION_KEY?: string;
  /** BotFather OIDC credentials; unset keeps Telegram phone verification disabled. */
  AUTH_TELEGRAM_CLIENT_ID?: string;
  AUTH_TELEGRAM_CLIENT_SECRET?: string;
  AUTH_EMAIL_PROVIDER?: "webhook" | "zeptomail" | "managed";
  AUTH_EMAIL_ENCRYPTION_KEY?: string;
  AUTH_EMAIL_WEBHOOK_URL?: string;
  AUTH_EMAIL_WEBHOOK_TOKEN?: string;
  AUTH_EMAIL_FROM?: string;
  /** Legacy production Supabase URL used only by the pre-cutover Admin bridge. */
  SUPABASE_URL?: string;
  /** Hard-pinned isolated Free Stage 3 destination for Better Auth provisioning. */
  SUPABASE_PROVISIONING_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Public key for caller-scoped Better Auth admin-role reads in the isolated staging project. */
  SUPABASE_PROVISIONING_PUBLISHABLE_KEY?: string;
  /** Preferred server-only Supabase provisioning key (`sb_secret_*` or legacy service_role JWT); never expose to browser bundles or logs. */
  SUPABASE_PROVISIONING_API_KEY?: string;
  /** Backward-compatible alias for existing deployments; prefer SUPABASE_PROVISIONING_API_KEY. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Explicit opt-in. Missing/false keeps the Worker in isolated auth-only mode. */
  SUPABASE_PROVISIONING_ENABLED?: string;
  DEV_APP_ORIGIN?: string;
  OAUTH_CLIENT_BOOTSTRAP_TOKEN?: string;
  OAUTH_CALLBACK_URL?: string;
  D1_SCHEMA_BOOTSTRAP_TOKEN?: string;
  ALLOW_SCHEMA_BOOTSTRAP?: string;
}

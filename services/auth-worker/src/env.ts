export interface AuthWorkerEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ORIGIN: string;
  SUPABASE_RESOURCE_AUDIENCE: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_EMAIL_PROVIDER?: "webhook" | "zeptomail";
  AUTH_EMAIL_ENCRYPTION_KEY?: string;
  AUTH_EMAIL_WEBHOOK_URL?: string;
  AUTH_EMAIL_WEBHOOK_TOKEN?: string;
  AUTH_EMAIL_FROM?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Server-only Supabase secret; never expose to browser bundles or logs. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Explicit opt-in. Missing/false keeps the Worker in isolated auth-only mode. */
  SUPABASE_PROVISIONING_ENABLED?: string;
  DEV_APP_ORIGIN?: string;
  OAUTH_CLIENT_BOOTSTRAP_TOKEN?: string;
  OAUTH_CALLBACK_URL?: string;
  /** Temporary secret gate for the staging-only OIDC acceptance helper. */
  OIDC_ACCEPTANCE_TEST_TOKEN?: string;
  D1_SCHEMA_BOOTSTRAP_TOKEN?: string;
  ALLOW_SCHEMA_BOOTSTRAP?: string;
}

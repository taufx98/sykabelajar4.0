export interface AuthWorkerEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ORIGIN: string;
  SUPABASE_RESOURCE_AUDIENCE: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_EMAIL_PROVIDER?: "webhook" | "resend";
  RESEND_API_KEY?: string;
  AUTH_EMAIL_WEBHOOK_URL?: string;
  AUTH_EMAIL_WEBHOOK_TOKEN?: string;
  AUTH_EMAIL_FROM?: string;
  DEV_APP_ORIGIN?: string;
  OAUTH_CLIENT_BOOTSTRAP_TOKEN?: string;
  OAUTH_CALLBACK_URL?: string;
  D1_SCHEMA_BOOTSTRAP_TOKEN?: string;
  ALLOW_SCHEMA_BOOTSTRAP?: string;
}

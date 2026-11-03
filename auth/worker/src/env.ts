export interface Env {
  DB: D1Database;

  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ORIGINS: string;
  SUPABASE_RESOURCE: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;

  OAUTH_CLIENT_ID?: string;
  OAUTH_REDIRECT_URIS?: string;
  AUTH_MIGRATION_SECRET?: string;
  AUTH_BOOTSTRAP_SECRET?: string;
  POC_ENABLED?: string;
}

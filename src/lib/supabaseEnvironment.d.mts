export interface SupabaseRuntimeEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_BETTER_AUTH_SUPABASE_URL?: string;
  VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY?: string;
}

export function resolveSupabaseEnvironment(
  hostname: string,
  environment: SupabaseRuntimeEnvironment | Record<string, string | undefined>,
): {
  supabaseUrl: string;
  supabasePublishableKey: string;
  isBetterAuthStaging: boolean;
};

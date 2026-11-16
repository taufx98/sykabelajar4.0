export interface SupabaseClientOptionsInput {
  useExternalAuth: boolean;
  getExternalAccessToken?: () => Promise<string | null>;
  fetchImpl: typeof fetch;
}

export interface SupabaseClientOptionsOutput {
  auth: {
    autoRefreshToken: boolean;
    persistSession: boolean;
    detectSessionInUrl: boolean;
  };
  global: { fetch: typeof fetch };
  accessToken?: () => Promise<string | null>;
}

export function createSupabaseClientOptions(
  input: SupabaseClientOptionsInput,
): SupabaseClientOptionsOutput;

export class BetterAuthAdminAuthError extends Error {
  code: string;
  constructor(code: string);
}

export function isBetterAuthTokenForIssuer(
  token: string,
  authBaseUrl: string,
): boolean;

export interface ResolveBetterAuthAdminIdentityInput {
  accessToken: string;
  authBaseUrl: string;
  resourceAudience: string;
  supabaseUrl: string;
  supabaseEnvironment?: "staging" | "production";
  publishableKey: string;
  jwksDb: {
    prepare(sql: string): {
      all(): Promise<{ results?: Array<unknown> }>;
    };
  };
  allowUnverifiedEmail?: boolean;
  fetchImpl?: typeof fetch;
  verifyJwtImpl?: (
    jwt: string,
    key: unknown,
    options: Record<string, unknown>,
  ) => Promise<{ payload: Record<string, unknown> }>;
  createLocalJwksImpl?: (
    jwks: { keys: Array<Record<string, unknown>> },
  ) => unknown;
  nowSeconds?: number;
}

export function publicBetterAuthAdminAuthError(
  code: string,
): { error: string; status: 401 | 503 } | null;

export function resolveBetterAuthAdminIdentity(
  input: ResolveBetterAuthAdminIdentityInput,
): Promise<{ id: string; email: string }>;

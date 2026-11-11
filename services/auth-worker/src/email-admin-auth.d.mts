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
  publishableKey: string;
  allowUnverifiedEmail?: boolean;
  fetchImpl?: typeof fetch;
  verifyJwtImpl?: (
    jwt: string,
    key: unknown,
    options: Record<string, unknown>,
  ) => Promise<{ payload: Record<string, unknown> }>;
  createJwksImpl?: (
    url: URL,
    options?: Record<string, unknown>,
  ) => unknown;
  nowSeconds?: number;
}

export function resolveBetterAuthAdminIdentity(
  input: ResolveBetterAuthAdminIdentityInput,
): Promise<{ id: string; email: string }>;

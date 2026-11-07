/**
 * Staging-only Better Auth transport boundary.
 *
 * This module is intentionally not imported by AppContext or the existing
 * auth.service.ts. Supabase Auth remains the only live frontend session source
 * until Stage 3/5/6 gates pass and a separately reviewed Stage 4 cutover occurs.
 *
 * It uses the Better Auth HTTP contract directly so the frontend lockfile and
 * production bundle do not acquire a second auth SDK before that decision.
 */
export type BetterAuthAccountType = 'student' | 'teacher' | 'organizer';
export type BetterAuthSocialProvider = 'google' | 'facebook' | 'twitter';

export interface BetterAuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
}

export interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface BetterAuthSessionEnvelope {
  user: BetterAuthUser;
  session: BetterAuthSession;
}

export interface BetterAuthRegistrationInput {
  email: string;
  password: string;
  name: string;
  username: string;
  accountType: BetterAuthAccountType;
  birthDate?: string;
  institution?: string;
  grade?: string;
  subjects?: string;
  referralCode?: string;
}

export interface BetterAuthSignInResult {
  redirect?: boolean;
  url?: string;
  token?: string | null;
  user?: BetterAuthUser;
}

export interface BetterAuthSocialSignInResult {
  url?: string;
  redirect?: boolean;
}

export class BetterAuthClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'BetterAuthClientError';
    this.status = status;
    this.code = code;
  }
}

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

export interface BetterAuthApiClient {
  getSession(): Promise<BetterAuthSessionEnvelope | null>;
  getResourceToken(): Promise<string>;
  signInWithEmail(email: string, password: string): Promise<BetterAuthSignInResult>;
  signInWithSocial(provider: BetterAuthSocialProvider, callbackURL: string): Promise<BetterAuthSocialSignInResult>;
  signUp(input: BetterAuthRegistrationInput): Promise<BetterAuthSignInResult>;
  sendVerificationEmail(email: string, callbackURL: string): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string, revokeOtherSessions?: boolean): Promise<void>;
  signOut(): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const ACCOUNT_TYPES = new Set<BetterAuthAccountType>(['student', 'teacher', 'organizer']);

function resolveAuthBaseUrl(authWorkerUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(authWorkerUrl);
  } catch {
    throw new BetterAuthClientError(503, 'AUTH_WORKER_URL_INVALID');
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const protocolAllowed = parsed.protocol === 'https:' || (isLocalhost && parsed.protocol === 'http:');
  if (!protocolAllowed || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new BetterAuthClientError(503, 'AUTH_WORKER_URL_INVALID');
  }

  return parsed.origin + '/api/auth';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeErrorCode(body: unknown): string {
  if (!isRecord(body)) return 'AUTH_REQUEST_FAILED';
  const candidate = [body.code, body.error, body.message].find(
    (value) => typeof value === 'string' && /^[A-Z0-9_]{2,80}$/.test(value),
  );
  return typeof candidate === 'string' ? candidate : 'AUTH_REQUEST_FAILED';
}

function isBetterAuthSessionEnvelope(value: unknown): value is BetterAuthSessionEnvelope {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) return false;
  return (
    typeof value.user.id === 'string' &&
    UUID_PATTERN.test(value.user.id) &&
    typeof value.user.email === 'string' &&
    typeof value.user.emailVerified === 'boolean' &&
    typeof value.user.name === 'string' &&
    typeof value.session.id === 'string' &&
    value.session.userId === value.user.id &&
    typeof value.session.expiresAt === 'string'
  );
}

function normalizeRegistration(input: BetterAuthRegistrationInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();

  if (!email || email.length > 254 || !email.includes('@')) {
    throw new BetterAuthClientError(400, 'REGISTRATION_EMAIL_INVALID');
  }
  if (input.password.length < 8) {
    throw new BetterAuthClientError(400, 'REGISTRATION_PASSWORD_TOO_SHORT');
  }
  if (!name || name.length > 120) {
    throw new BetterAuthClientError(400, 'REGISTRATION_NAME_INVALID');
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new BetterAuthClientError(400, 'REGISTRATION_USERNAME_INVALID');
  }
  if (!ACCOUNT_TYPES.has(input.accountType)) {
    throw new BetterAuthClientError(400, 'REGISTRATION_ACCOUNT_TYPE_INVALID');
  }

  return {
    email,
    password: input.password,
    name,
    username,
    accountType: input.accountType,
    ...(input.birthDate ? { birthDate: input.birthDate } : {}),
    ...(input.institution ? { institution: input.institution.trim().toUpperCase() } : {}),
    ...(input.grade ? { grade: input.grade.trim().toLowerCase() } : {}),
    ...(input.subjects ? { subjects: input.subjects.trim() } : {}),
    ...(input.referralCode ? { referralCode: input.referralCode.trim() } : {}),
  };
}

export function createBetterAuthApiClient(options: {
  authWorkerUrl: string;
  fetchImpl?: FetchLike;
}): BetterAuthApiClient {
  const baseUrl = resolveAuthBaseUrl(options.authWorkerUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, body?: JsonRecord): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new BetterAuthClientError(503, 'AUTH_WORKER_UNAVAILABLE');
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new BetterAuthClientError(502, 'AUTH_WORKER_BAD_RESPONSE');
    }
    if (!response.ok) throw new BetterAuthClientError(response.status, safeErrorCode(payload));
    return payload as T;
  }

  return {
    async getSession() {
      const payload = await request<unknown>('/get-session');
      if (payload === null) return null;
      if (!isBetterAuthSessionEnvelope(payload)) {
        throw new BetterAuthClientError(502, 'AUTH_SESSION_RESPONSE_INVALID');
      }
      if (payload.user.emailVerified !== true) {
        throw new BetterAuthClientError(403, 'EMAIL_VERIFICATION_REQUIRED');
      }
      const expiration = Date.parse(payload.session.expiresAt);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        throw new BetterAuthClientError(401, 'AUTH_SESSION_EXPIRED');
      }
      return payload;
    },

    async getResourceToken() {
      const payload = await request<unknown>('/token');
      if (!isRecord(payload) || typeof payload.token !== 'string' || payload.token.length < 20) {
        throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_RESPONSE_INVALID');
      }
      // The token is returned to the caller for one request only. Never persist
      // it in localStorage, sessionStorage, IndexedDB, or application profile state.
      return payload.token;
    },

    signInWithEmail(email, password) {
      return request<BetterAuthSignInResult>('/sign-in/email', {
        email: email.trim().toLowerCase(),
        password,
      });
    },

    signInWithSocial(provider, callbackURL) {
      return request<BetterAuthSocialSignInResult>('/sign-in/social', {
        provider,
        callbackURL,
      });
    },

    signUp(input) {
      return request<BetterAuthSignInResult>('/sign-up/email', normalizeRegistration(input));
    },

    async sendVerificationEmail(email, callbackURL) {
      await request<unknown>('/send-verification-email', {
        email: email.trim().toLowerCase(),
        callbackURL,
      });
    },

    async requestPasswordReset(email, redirectTo) {
      await request<unknown>('/request-password-reset', {
        email: email.trim().toLowerCase(),
        redirectTo,
      });
    },

    async resetPassword(token, newPassword) {
      if (!token.trim() || newPassword.length < 8) {
        throw new BetterAuthClientError(400, 'PASSWORD_RESET_INPUT_INVALID');
      }
      await request<unknown>('/reset-password', { token: token.trim(), newPassword });
    },

    async changePassword(currentPassword, newPassword, revokeOtherSessions = true) {
      if (!currentPassword || newPassword.length < 8) {
        throw new BetterAuthClientError(400, 'PASSWORD_CHANGE_INPUT_INVALID');
      }
      await request<unknown>('/change-password', {
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
    },

    async signOut() {
      await request<unknown>('/sign-out', {});
    },
  };
}

/** Explicit opt-in check; the existing app never enables this automatically. */
export function isBetterAuthFrontendEnabled(): boolean {
  return (
    import.meta.env.VITE_BETTER_AUTH_FRONTEND_ENABLED === 'true' &&
    typeof import.meta.env.VITE_AUTH_WORKER_URL === 'string' &&
    import.meta.env.VITE_AUTH_WORKER_URL.trim().length > 0
  );
}

let stagingClient: BetterAuthApiClient | null = null;

/**
 * Only Stage 4 screens that are deliberately being tested may call this.
 * It throws unless an explicit non-production frontend flag is present.
 */
export function getStagingBetterAuthClient(): BetterAuthApiClient {
  if (!isBetterAuthFrontendEnabled()) {
    throw new BetterAuthClientError(503, 'BETTER_AUTH_FRONTEND_DISABLED');
  }
  if (!stagingClient) {
    stagingClient = createBetterAuthApiClient({
      authWorkerUrl: import.meta.env.VITE_AUTH_WORKER_URL!,
    });
  }
  return stagingClient;
}

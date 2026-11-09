/**
 * Staging-only Better Auth transport boundary.
 *
 * auth.service.ts selects this transport only behind the explicit preview-only
 * host and isolated-Supabase allowlist. AppContext never imports it directly.
 * Supabase Auth remains the default provider until a separately reviewed
 * Stage 4 cutover occurs.
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
  callbackURL?: string;
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

export interface BetterAuthPhoneVerificationStatus {
  verified: boolean;
}

export interface BetterAuthTelegramPhoneChallenge {
  authorizationUrl: string;
  expiresAt: string;
}

export interface BetterAuthLoginProviderSetting {
  provider: BetterAuthSocialProvider;
  primary: boolean;
  enabled: boolean;
  clientId: string;
  secretConfigured: boolean;
  source: string;
  callbackUrl: string;
  status: string;
  updatedAt: string | null;
}

export interface BetterAuthLoginProviderSettings {
  revision: number;
  managedMode: boolean;
  encryptionKeyConfigured: boolean;
  emailVerificationConfigured: boolean;
  providers: BetterAuthLoginProviderSetting[];
  instagram: { available: false; reason: string };
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
  getSupabaseAccessToken(): Promise<string | null>;
  signInWithEmail(email: string, password: string): Promise<BetterAuthSignInResult>;
  signInWithSocial(provider: BetterAuthSocialProvider, callbackURL: string): Promise<BetterAuthSocialSignInResult>;
  getAvailableSocialProviders(): Promise<BetterAuthSocialProvider[]>;
  getLoginProviderSettings(): Promise<BetterAuthLoginProviderSettings>;
  saveLoginProvider(input: { provider: BetterAuthSocialProvider; clientId: string; clientSecret?: string; enabled?: boolean }): Promise<BetterAuthLoginProviderSettings>;
  setLoginProviderEnabled(provider: BetterAuthSocialProvider, enabled: boolean): Promise<BetterAuthLoginProviderSettings>;
  validateLoginProvider(provider: BetterAuthSocialProvider): Promise<{ ok: true; provider: BetterAuthSocialProvider; enabled: boolean; status: string; hostedSignInRequired: true; message: string }>;
  signUp(input: BetterAuthRegistrationInput): Promise<BetterAuthSignInResult>;
  sendVerificationEmail(email: string, callbackURL: string): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string, revokeOtherSessions?: boolean): Promise<void>;
  getTelegramPhoneVerificationStatus(): Promise<BetterAuthPhoneVerificationStatus>;
  startTelegramPhoneVerification(): Promise<BetterAuthTelegramPhoneChallenge>;
  signOut(): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const ACCOUNT_TYPES = new Set<BetterAuthAccountType>(['student', 'teacher', 'organizer']);

const FIRST_PARTY_OAUTH_CLIENT_ID = 'sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y';
const SUPABASE_RESOURCE_AUDIENCE = 'https://sykabelajar.my.id';
const OAUTH_CALLBACK_PATH = '/auth/oidc/callback';
const ALLOWED_OAUTH_CALLBACK_ORIGINS = new Set([
  'https://sykabelajar.my.id',
  'https://staging.sykabelajar.my.id',
]);
const RESOURCE_TOKEN_REFRESH_MARGIN_MS = 45_000;
const RESOURCE_TOKEN_MAX_TTL_SECONDS = 300;
const OAUTH_CALLBACK_TIMEOUT_MS = 20_000;

type OAuthCallbackMessage = {
  source: 'sykabelajar-better-auth-oidc';
  state: string;
  code?: string | null;
  issuer?: string | null;
  error?: string | null;
};

type ValidatedResourceToken = {
  token: string;
  expiresAt: number;
  userId: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_FORMAT_INVALID');
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(payload)) throw new Error('INVALID_JWT_PAYLOAD');
    return payload;
  } catch {
    throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_FORMAT_INVALID');
  }
}

function validateResourceAccessToken(
  token: string,
  userId: string,
  expectedIssuer: string,
  expiresIn: unknown,
): number {
  const payload = decodeJwtPayload(token);
  const audience = payload.aud;
  const audienceMatches = audience === SUPABASE_RESOURCE_AUDIENCE ||
    (Array.isArray(audience) && audience.includes(SUPABASE_RESOURCE_AUDIENCE));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiration = Number(payload.exp);
  const lifetime = Number(expiresIn);

  if (
    payload.iss !== expectedIssuer ||
    payload.sub !== userId ||
    payload.role !== 'authenticated' ||
    !audienceMatches ||
    !Number.isInteger(expiration) ||
    expiration <= nowSeconds + 10 ||
    expiration > nowSeconds + RESOURCE_TOKEN_MAX_TTL_SECONDS + 10 ||
    !Number.isFinite(lifetime) ||
    lifetime <= 0 ||
    lifetime > RESOURCE_TOKEN_MAX_TTL_SECONDS
  ) {
    throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_CLAIMS_INVALID');
  }
  return expiration * 1000;
}

function resolveOAuthCallbackUrl(): string {
  if (typeof window === 'undefined') {
    throw new BetterAuthClientError(503, 'AUTH_BROWSER_CONTEXT_REQUIRED');
  }
  const origin = window.location.origin;
  if (!ALLOWED_OAUTH_CALLBACK_ORIGINS.has(origin)) {
    throw new BetterAuthClientError(403, 'AUTH_OAUTH_CALLBACK_ORIGIN_NOT_ALLOWED');
  }
  return new URL(OAUTH_CALLBACK_PATH, origin).toString();
}

async function requestAuthorizationCode(
  authorizeUrl: URL,
  state: string,
  callbackOrigin: string,
): Promise<{ code: string; issuer: string }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new BetterAuthClientError(503, 'AUTH_BROWSER_CONTEXT_REQUIRED');
  }

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = 'SYKABELAJAR secure authentication';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== callbackOrigin || event.source !== frame.contentWindow) return;
      if (!isRecord(event.data) || event.data.source !== 'sykabelajar-better-auth-oidc') return;
      const message = event.data as OAuthCallbackMessage;
      if (message.state !== state) {
        finish(() => reject(new BetterAuthClientError(401, 'AUTH_OAUTH_STATE_MISMATCH')));
        return;
      }
      if (message.error) {
        const code = message.error === 'login_required'
          ? 'AUTH_SESSION_REQUIRED'
          : message.error === 'consent_required'
            ? 'AUTH_CONSENT_REQUIRED'
            : 'AUTH_OAUTH_AUTHORIZATION_FAILED';
        finish(() => reject(new BetterAuthClientError(401, code)));
        return;
      }
      if (typeof message.code !== 'string' || !message.code ||
          message.issuer !== authorizeUrl.origin + '/api/auth') {
        finish(() => reject(new BetterAuthClientError(502, 'AUTH_OAUTH_CALLBACK_INVALID')));
        return;
      }
      finish(() => resolve({ code: message.code!, issuer: message.issuer! }));
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new BetterAuthClientError(504, 'AUTH_OAUTH_CALLBACK_TIMEOUT'))),
      OAUTH_CALLBACK_TIMEOUT_MS,
    );

    window.addEventListener('message', onMessage);
    frame.src = authorizeUrl.toString();
    document.body.appendChild(frame);
  });
}


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
    ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
  };
}

export function createBetterAuthApiClient(options: {
  authWorkerUrl: string;
  fetchImpl?: FetchLike;
}): BetterAuthApiClient {
  const baseUrl = resolveAuthBaseUrl(options.authWorkerUrl);
  const workerOrigin = baseUrl.replace(/\/api\/auth$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  let cachedResourceToken: ValidatedResourceToken | null = null;
  let resourceTokenGeneration = 0;
  let resourceTokenInFlight: { userId: string; generation: number; promise: Promise<string> } | null = null;

  function clearResourceTokenCache() {
    resourceTokenGeneration += 1;
    cachedResourceToken = null;
    resourceTokenInFlight = null;
  }

  async function getResourceTokenForSession(session: BetterAuthSessionEnvelope): Promise<string> {
    const userId = session.user.id;
    if (cachedResourceToken?.userId === userId &&
        cachedResourceToken.expiresAt > Date.now() + RESOURCE_TOKEN_REFRESH_MARGIN_MS) {
      return cachedResourceToken.token;
    }
    if (resourceTokenInFlight?.userId === userId &&
        resourceTokenInFlight.generation === resourceTokenGeneration) {
      return resourceTokenInFlight.promise;
    }

    const generation = resourceTokenGeneration;
    const promise = (async () => {
      const verifier = randomBase64Url(64);
      const state = randomBase64Url(32);
      const callbackUrl = resolveOAuthCallbackUrl();
      const callbackOrigin = new URL(callbackUrl).origin;
      const challenge = await createPkceChallenge(verifier);
      const authorizeUrl = new URL(baseUrl + '/oauth2/authorize');
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: FIRST_PARTY_OAUTH_CLIENT_ID,
        redirect_uri: callbackUrl,
        scope: 'openid profile email',
        resource: SUPABASE_RESOURCE_AUDIENCE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'none',
      }).toString();

      const authorization = await requestAuthorizationCode(authorizeUrl, state, callbackOrigin);
      if (authorization.issuer !== baseUrl) {
        throw new BetterAuthClientError(502, 'AUTH_OAUTH_ISSUER_MISMATCH');
      }

      let response: Response;
      try {
        response = await fetchImpl(baseUrl + '/oauth2/token', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: FIRST_PARTY_OAUTH_CLIENT_ID,
            code: authorization.code,
            redirect_uri: callbackUrl,
            code_verifier: verifier,
            resource: SUPABASE_RESOURCE_AUDIENCE,
          }).toString(),
        });
      } catch {
        throw new BetterAuthClientError(503, 'AUTH_RESOURCE_TOKEN_UNAVAILABLE');
      }

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        if (response.ok) throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_RESPONSE_INVALID');
      }
      if (!response.ok || !isRecord(payload)) {
        const errorCode = isRecord(payload) && payload.error === 'invalid_grant'
          ? 'AUTH_OAUTH_CODE_REJECTED'
          : 'AUTH_RESOURCE_TOKEN_EXCHANGE_FAILED';
        throw new BetterAuthClientError(response.status || 502, errorCode);
      }
      if (typeof payload.access_token !== 'string' ||
          payload.token_type !== 'Bearer' ||
          typeof payload.refresh_token === 'string') {
        throw new BetterAuthClientError(502, 'AUTH_RESOURCE_TOKEN_RESPONSE_INVALID');
      }

      const expiresAt = validateResourceAccessToken(
        payload.access_token,
        userId,
        baseUrl,
        payload.expires_in,
      );
      if (generation === resourceTokenGeneration) {
        cachedResourceToken = { userId, token: payload.access_token, expiresAt };
      }
      return payload.access_token;
    })();

    resourceTokenInFlight = { userId, generation, promise };
    try {
      return await promise;
    } finally {
      if (resourceTokenInFlight?.promise === promise) resourceTokenInFlight = null;
    }
  }

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

  async function requestWorker<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(workerOrigin + path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
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

  async function requestAdmin<T>(body?: JsonRecord): Promise<T> {
    const session = await request<unknown>('/get-session');
    if (!isBetterAuthSessionEnvelope(session) || session.user.emailVerified !== true) {
      throw new BetterAuthClientError(401, 'AUTH_SESSION_REQUIRED');
    }
    const expiresAt = Date.parse(session.session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearResourceTokenCache();
      throw new BetterAuthClientError(401, 'AUTH_SESSION_EXPIRED');
    }
    const accessToken = await getResourceTokenForSession(session);
    const workerOrigin = baseUrl.replace(/\/api\/auth$/, '');
    let response: Response;
    try {
      response = await fetchImpl(workerOrigin + '/api/admin/login-providers', {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          Authorization: 'Bearer ' + accessToken,
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
    async getTelegramPhoneVerificationStatus() {
      const payload = await requestWorker<unknown>('/api/phone-verification/telegram/status');
      if (!isRecord(payload) || typeof payload.verified !== 'boolean') {
        throw new BetterAuthClientError(502, 'PHONE_VERIFICATION_STATUS_RESPONSE_INVALID');
      }
      return { verified: payload.verified };
    },

    async startTelegramPhoneVerification() {
      const payload = await requestWorker<unknown>('/api/phone-verification/telegram/start', 'POST');
      if (
        !isRecord(payload) ||
        typeof payload.authorization_url !== 'string' ||
        typeof payload.expires_at !== 'string'
      ) {
        throw new BetterAuthClientError(502, 'PHONE_VERIFICATION_CHALLENGE_RESPONSE_INVALID');
      }
      let authorizationUrl: URL;
      try {
        authorizationUrl = new URL(payload.authorization_url);
      } catch {
        throw new BetterAuthClientError(502, 'PHONE_VERIFICATION_URL_INVALID');
      }
      const expiresAt = Date.parse(payload.expires_at);
      if (
        authorizationUrl.protocol !== 'https:' ||
        authorizationUrl.origin !== 'https://oauth.telegram.org' ||
        authorizationUrl.pathname !== '/auth' ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + 11 * 60 * 1000
      ) {
        throw new BetterAuthClientError(502, 'PHONE_VERIFICATION_CHALLENGE_INVALID');
      }
      return { authorizationUrl: authorizationUrl.toString(), expiresAt: new Date(expiresAt).toISOString() };
    },

    async getSession() {
      const payload = await request<unknown>('/get-session');
      if (payload === null) {
        clearResourceTokenCache();
        return null;
      }
      if (!isBetterAuthSessionEnvelope(payload)) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(502, 'AUTH_SESSION_RESPONSE_INVALID');
      }
      if (payload.user.emailVerified !== true) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(403, 'EMAIL_VERIFICATION_REQUIRED');
      }
      const expiration = Date.parse(payload.session.expiresAt);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(401, 'AUTH_SESSION_EXPIRED');
      }
      return payload;
    },

    async getResourceToken() {
      const session = await request<unknown>('/get-session');
      if (!isBetterAuthSessionEnvelope(session) || session.user.emailVerified !== true) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(401, 'AUTH_SESSION_REQUIRED');
      }
      const expiration = Date.parse(session.session.expiresAt);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(401, 'AUTH_SESSION_EXPIRED');
      }
      return getResourceTokenForSession(session);
    },

    async getSupabaseAccessToken() {
      const payload = await request<unknown>('/get-session');
      if (payload === null) {
        clearResourceTokenCache();
        return null;
      }
      if (!isBetterAuthSessionEnvelope(payload)) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(401, 'AUTH_SESSION_RESPONSE_INVALID');
      }
      if (payload.user.emailVerified !== true) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(403, 'EMAIL_VERIFICATION_REQUIRED');
      }
      const expiration = Date.parse(payload.session.expiresAt);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        clearResourceTokenCache();
        throw new BetterAuthClientError(401, 'AUTH_SESSION_EXPIRED');
      }
      return getResourceTokenForSession(payload);
    },

    signInWithEmail(email, password) {
      clearResourceTokenCache();
      return request<BetterAuthSignInResult>('/sign-in/email', {
        email: email.trim().toLowerCase(),
        password,
      });
    },

    signInWithSocial(provider, callbackURL) {
      clearResourceTokenCache();
      return request<BetterAuthSocialSignInResult>('/sign-in/social', {
        provider,
        callbackURL,
      });
    },

    async getAvailableSocialProviders() {
      const payload = await request<unknown>('/providers');
      if (!isRecord(payload) || !Array.isArray(payload.providers)) {
        throw new BetterAuthClientError(502, 'AUTH_SOCIAL_PROVIDER_RESPONSE_INVALID');
      }
      return payload.providers.filter(
        (provider): provider is BetterAuthSocialProvider =>
          provider === 'google' || provider === 'facebook' || provider === 'twitter',
      );
    },

    getLoginProviderSettings() {
      return requestAdmin<BetterAuthLoginProviderSettings>();
    },

    saveLoginProvider(input) {
      return requestAdmin<BetterAuthLoginProviderSettings>({
        action: 'save',
        provider: input.provider,
        clientId: input.clientId,
        ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
        ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      });
    },

    setLoginProviderEnabled(provider, enabled) {
      return requestAdmin<BetterAuthLoginProviderSettings>({
        action: 'set-enabled',
        provider,
        enabled,
      });
    },

    validateLoginProvider(provider) {
      return requestAdmin({
        action: 'validate',
        provider,
      });
    },

    signUp(input) {
      clearResourceTokenCache();
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
      clearResourceTokenCache();
    },

    async signOut() {
      clearResourceTokenCache();
      await request<unknown>('/sign-out', {});
    },
  };
}

/** Explicit opt-in check; the existing app never enables this automatically. */
export function isBetterAuthFrontendEnabled(): boolean {
  if (
    import.meta.env.VITE_BETTER_AUTH_FRONTEND_ENABLED !== 'true' ||
    typeof import.meta.env.VITE_AUTH_WORKER_URL !== 'string' ||
    !import.meta.env.VITE_AUTH_WORKER_URL.trim()
  ) {
    return false;
  }

  // Remote Better Auth is permitted only on the dedicated same-site custom
  // domain. Generic *.pages.dev previews cannot send its SameSite=Lax cookie.
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  const isLocalPreview = hostname === 'localhost' || hostname === '127.0.0.1';
  const isStagingDomain = hostname === 'staging.sykabelajar.my.id';

  try {
    const worker = new URL(import.meta.env.VITE_AUTH_WORKER_URL);
    const localWorker = worker.hostname === 'localhost' || worker.hostname === '127.0.0.1';
    if (isLocalPreview) return localWorker && worker.protocol === 'http:';
    return isStagingDomain && worker.protocol === 'https:' &&
      worker.hostname === 'auth.sykabelajar.my.id';
  } catch {
    return false;
  }
}

/**
 * Custom OIDC is configured only on the isolated FREE staging project. Do not
 * send Better Auth resource tokens to production if a Pages build inherits
 * the staging-only feature flag by mistake.
 */
export function isBetterAuthFrontendEnabledForSupabase(projectUrl: string): boolean {
  if (!isBetterAuthFrontendEnabled()) return false;
  try {
    return new URL(projectUrl).origin === 'https://ydamszdfsxqisanazdkb.supabase.co';
  } catch {
    return false;
  }
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

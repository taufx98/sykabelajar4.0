import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";

const STAGING_SUPABASE_ORIGIN = "https://ydamszdfsxqisanazdkb.supabase.co";
const PRODUCTION_SUPABASE_ORIGIN = "https://mvdczyitbkxkldjughor.supabase.co";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCESS_TOKEN_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

/** @type {string} */
let cachedJwksUrl = "";
/** @type {ReturnType<typeof createRemoteJWKSet> | null} */
let cachedJwks = null;

/** @type {Readonly<Record<string, string>>} */
const JOSE_FAILURE_CODES = Object.freeze({
  ERR_JOSE_ALG_NOT_ALLOWED: "BETTER_AUTH_RESOURCE_TOKEN_HEADER_INVALID",
  ERR_JOSE_GENERIC: "BETTER_AUTH_JWKS_UNAVAILABLE",
  ERR_JOSE_NOT_SUPPORTED: "BETTER_AUTH_RESOURCE_TOKEN_HEADER_INVALID",
  ERR_JWK_INVALID: "BETTER_AUTH_JWKS_INVALID",
  ERR_JWKS_NO_MATCHING_KEY: "BETTER_AUTH_JWKS_KEY_NOT_FOUND",
  ERR_JWKS_MULTIPLE_MATCHING_KEYS: "BETTER_AUTH_JWKS_KEY_AMBIGUOUS",
  ERR_JWKS_TIMEOUT: "BETTER_AUTH_JWKS_UNAVAILABLE",
  ERR_JWKS_INVALID: "BETTER_AUTH_JWKS_INVALID",
  ERR_JWS_SIGNATURE_VERIFICATION_FAILED: "BETTER_AUTH_RESOURCE_TOKEN_SIGNATURE_INVALID",
  ERR_JWT_EXPIRED: "BETTER_AUTH_RESOURCE_TOKEN_EXPIRED",
  ERR_JWT_CLAIM_VALIDATION_FAILED: "BETTER_AUTH_RESOURCE_TOKEN_CLAIMS_INVALID",
  ERR_JWS_INVALID: "BETTER_AUTH_RESOURCE_TOKEN_FORMAT_INVALID",
  ERR_JWT_INVALID: "BETTER_AUTH_RESOURCE_TOKEN_FORMAT_INVALID",
  BETTER_AUTH_JWKS_FETCH_FAILED: "BETTER_AUTH_JWKS_UNAVAILABLE",
  BETTER_AUTH_JWKS_UNAVAILABLE: "BETTER_AUTH_JWKS_UNAVAILABLE",
  BETTER_AUTH_JWKS_ENDPOINT_NOT_FOUND: "BETTER_AUTH_JWKS_ENDPOINT_NOT_FOUND",
  BETTER_AUTH_JWKS_ACCESS_DENIED: "BETTER_AUTH_JWKS_ACCESS_DENIED",
  BETTER_AUTH_JWKS_RESPONSE_INVALID: "BETTER_AUTH_JWKS_INVALID",
});

/**
 * Return only a fixed, non-sensitive diagnostic code from the JOSE verifier.
 * @param {unknown} error
 */
function safeJoseFailureCode(error) {
  let code = "";
  if (error && typeof error === "object") {
    /** @type {{code?: unknown}} */
    const errorWithCode = error;
    if (typeof errorWithCode.code === "string") code = errorWithCode.code;
  }
  return JOSE_FAILURE_CODES[code] ?? "BETTER_AUTH_RESOURCE_TOKEN_INVALID";
}

/** @type {Readonly<Record<string, {error:string, status:401|503}>>} */
const PUBLIC_ADMIN_AUTH_ERRORS = Object.freeze({
  BETTER_AUTH_JWKS_ENDPOINT_NOT_FOUND: { error: "AUTH_JWKS_ENDPOINT_NOT_FOUND", status: 503 },
  BETTER_AUTH_JWKS_ACCESS_DENIED: { error: "AUTH_JWKS_ACCESS_DENIED", status: 503 },
  BETTER_AUTH_RESOURCE_TOKEN_INVALID: { error: "AUTH_RESOURCE_TOKEN_INVALID", status: 401 },
  BETTER_AUTH_RESOURCE_TOKEN_HEADER_INVALID: { error: "AUTH_RESOURCE_TOKEN_HEADER_INVALID", status: 401 },
  BETTER_AUTH_RESOURCE_TOKEN_FORMAT_INVALID: { error: "AUTH_RESOURCE_TOKEN_FORMAT_INVALID", status: 401 },
  BETTER_AUTH_RESOURCE_TOKEN_SIGNATURE_INVALID: { error: "AUTH_RESOURCE_TOKEN_SIGNATURE_INVALID", status: 401 },
  BETTER_AUTH_RESOURCE_TOKEN_EXPIRED: { error: "AUTH_RESOURCE_TOKEN_EXPIRED", status: 401 },
  BETTER_AUTH_RESOURCE_TOKEN_CLAIMS_INVALID: { error: "AUTH_RESOURCE_TOKEN_CLAIMS_INVALID", status: 401 },
  BETTER_AUTH_JWKS_KEY_NOT_FOUND: { error: "AUTH_JWKS_KEY_NOT_FOUND", status: 401 },
  BETTER_AUTH_JWKS_KEY_AMBIGUOUS: { error: "AUTH_JWKS_KEY_AMBIGUOUS", status: 401 },
  BETTER_AUTH_JWKS_UNAVAILABLE: { error: "AUTH_JWKS_UNAVAILABLE", status: 503 },
  BETTER_AUTH_JWKS_INVALID: { error: "AUTH_JWKS_INVALID", status: 503 },
  BETTER_AUTH_USERINFO_INVALID: { error: "AUTH_USERINFO_INVALID", status: 401 },
  BETTER_AUTH_USERINFO_UNAVAILABLE: { error: "AUTH_USERINFO_UNAVAILABLE", status: 503 },
});

/**
 * Convert internal verifier failures to a fixed public code and HTTP status.
 * @param {string} code
 */
export function publicBetterAuthAdminAuthError(code) {
  return PUBLIC_ADMIN_AUTH_ERRORS[code] ?? null;
}

export class BetterAuthAdminAuthError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "BetterAuthAdminAuthError";
    this.code = code;
  }
}

/** @param {string} code */
function codedJwksFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * Normalize only the remote JWKS transport boundary. Do not expose upstream
 * response bodies, URLs, headers, or runtime error messages to Admin clients.
 * @param {string} url
 * @param {RequestInit} init
 * @param {typeof fetch} fetchImpl
 */
async function fetchRemoteJwks(url, init, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error && typeof error === "object" && error.name === "TimeoutError") {
      throw error;
    }
    throw codedJwksFailure("BETTER_AUTH_JWKS_FETCH_FAILED");
  }

  if (response.status !== 200) {
    if (response.status === 404) {
      throw codedJwksFailure("BETTER_AUTH_JWKS_ENDPOINT_NOT_FOUND");
    }
    if (response.status === 401 || response.status === 403) {
      throw codedJwksFailure("BETTER_AUTH_JWKS_ACCESS_DENIED");
    }
    throw codedJwksFailure("BETTER_AUTH_JWKS_UNAVAILABLE");
  }

  try {
    await response.clone().json();
  } catch {
    throw codedJwksFailure("BETTER_AUTH_JWKS_RESPONSE_INVALID");
  }
  return response;
}

/** @param {string} authBaseUrl */
function authIssuer(authBaseUrl) {
  let url;
  try {
    url = new URL(authBaseUrl);
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_CONFIGURATION_INVALID");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_CONFIGURATION_INVALID");
  }

  return url.origin + "/api/auth";
}

/**
 * Selects exactly one approved identity/role database for the current Worker
 * environment. The environment flag and URL must agree; there is no fallback
 * between staging and Production.
 *
 * @param {string} value
 * @param {"staging"|"production"} environment
 */
function pinnedSupabaseOrigin(value, environment = "staging") {
  const expectedOrigin = environment === "staging"
    ? STAGING_SUPABASE_ORIGIN
    : environment === "production"
      ? PRODUCTION_SUPABASE_ORIGIN
      : null;
  if (!expectedOrigin) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_PROJECT_NOT_ALLOWED");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_NOT_CONFIGURED");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== expectedOrigin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_PROJECT_NOT_ALLOWED");
  }
  return url.origin;
}

/**
 * This function only chooses which verifier should handle a bearer token.
 * The decoded iss is untrusted until resolveBetterAuthAdminIdentity verifies
 * the token signature, issuer, audience and lifetime with the pinned JWKS.
 *
 * @param {string} token
 * @param {string} authBaseUrl
 */
export function isBetterAuthTokenForIssuer(token, authBaseUrl) {
  try {
    const issuer = authIssuer(authBaseUrl);
    return decodeJwt(token).iss === issuer;
  } catch {
    return false;
  }
}

/**
 * Verify a Better Auth resource token, retrieve the verified email from OIDC
 * UserInfo, then check active admin membership only in the exact Supabase
 * identity project pinned by this Worker environment using its publishable key.
 *
 * @param {{
 *   accessToken:string,
 *   authBaseUrl:string,
 *   resourceAudience:string,
 *   supabaseUrl:string,
 *   supabaseEnvironment?:"staging"|"production",
 *   publishableKey:string,
 *   allowUnverifiedEmail?:boolean,
 *   fetchImpl?:typeof fetch,
 *   verifyJwtImpl?:typeof jwtVerify,
 *   createJwksImpl?:typeof createRemoteJWKSet,
 *   nowSeconds?:number
 * }} input
 */
export async function resolveBetterAuthAdminIdentity(input) {
  const accessToken = typeof input?.accessToken === "string" ? input.accessToken.trim() : "";
  const resourceAudience = typeof input?.resourceAudience === "string" ? input.resourceAudience.trim() : "";
  const publishableKey = typeof input?.publishableKey === "string" ? input.publishableKey.trim() : "";
  const allowUnverifiedEmail = input?.allowUnverifiedEmail === true;
  const authBaseUrl = typeof input?.authBaseUrl === "string" ? input.authBaseUrl : "";
  if (
    !accessToken ||
    accessToken.length > 8192 ||
    !resourceAudience ||
    !publishableKey.startsWith("sb_publishable_") ||
    publishableKey.length > 256
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_NOT_CONFIGURED");
  }

  const issuer = authIssuer(authBaseUrl);
  const supabaseOrigin = pinnedSupabaseOrigin(input.supabaseUrl, input.supabaseEnvironment ?? "staging");
  const jwksUrl = issuer + "/jwks";
  const fetchImpl = input.fetchImpl ?? fetch;
  const verifyJwtImpl = input.verifyJwtImpl ?? jwtVerify;
  const createJwksImpl = input.createJwksImpl ?? createRemoteJWKSet;
  const nowSeconds = typeof input.nowSeconds === "number" && Number.isSafeInteger(input.nowSeconds)
    ? input.nowSeconds
    : Math.floor(Date.now() / 1000);

  let protectedHeader;
  try {
    protectedHeader = decodeProtectedHeader(accessToken);
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_HEADER_INVALID");
  }
  if (
    protectedHeader.alg !== "ES256" ||
    typeof protectedHeader.kid !== "string" ||
    !protectedHeader.kid.trim()
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_HEADER_INVALID");
  }

  let payload;
  try {
    if (!cachedJwks || cachedJwksUrl !== jwksUrl || input.createJwksImpl) {
      cachedJwksUrl = jwksUrl;
      const jwksFetch = input.fetchImpl ?? fetch;
      cachedJwks = createJwksImpl(new URL(jwksUrl), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
        [customFetch]: (url, init) => fetchRemoteJwks(url, init, jwksFetch),
      });
    }
    const verified = await verifyJwtImpl(accessToken, cachedJwks, {
      issuer,
      audience: resourceAudience,
      algorithms: ["ES256"],
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    payload = verified.payload;
  } catch (error) {
    throw new BetterAuthAdminAuthError(safeJoseFailureCode(error));
  }

  const audienceMatches = payload.aud === resourceAudience ||
    (Array.isArray(payload.aud) && payload.aud.includes(resourceAudience));
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  if (
    payload.iss !== issuer ||
    !audienceMatches ||
    payload.role !== "authenticated" ||
    typeof payload.sub !== "string" ||
    !UUID_PATTERN.test(payload.sub) ||
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
    expiresAt <= nowSeconds - CLOCK_SKEW_SECONDS ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_ACCESS_TOKEN_AGE_SECONDS
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_CLAIMS_INVALID");
  }

  let userInfoResponse;
  try {
    userInfoResponse = await fetchImpl(issuer + "/oauth2/userinfo", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_USERINFO_UNAVAILABLE");
  }
  if (!userInfoResponse.ok) {
    if (userInfoResponse.status === 429 || userInfoResponse.status >= 500) {
      throw new BetterAuthAdminAuthError("BETTER_AUTH_USERINFO_UNAVAILABLE");
    }
    throw new BetterAuthAdminAuthError("BETTER_AUTH_USERINFO_INVALID");
  }

  const userInfo = await userInfoResponse.json().catch(() => null);
  const email = typeof userInfo?.email === "string" ? userInfo.email.trim() : "";
  if (
    userInfo?.sub !== payload.sub ||
    typeof userInfo?.email_verified !== "boolean" ||
    (!allowUnverifiedEmail && userInfo.email_verified !== true) ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_USERINFO_INVALID");
  }

  const roleUrl = new URL("/rest/v1/user_roles", supabaseOrigin);
  roleUrl.searchParams.set("select", "user_id,role,is_active");
  roleUrl.searchParams.set("user_id", "eq." + payload.sub);
  roleUrl.searchParams.set("role", "eq.admin");
  roleUrl.searchParams.set("is_active", "eq.true");
  roleUrl.searchParams.set("limit", "1");

  let roleResponse;
  try {
    roleResponse = await fetchImpl(roleUrl.toString(), {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_CHECK_UNAVAILABLE");
  }
  if (!roleResponse.ok) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_CHECK_FAILED");
  }

  const roleRows = await roleResponse.json().catch(() => null);
  const isActiveAdmin = Array.isArray(roleRows) && roleRows.some((row) =>
    row &&
    row.user_id === payload.sub &&
    row.role === "admin" &&
    row.is_active === true
  );
  if (!isActiveAdmin) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_REQUIRED");
  }

  return { id: payload.sub, email };
}

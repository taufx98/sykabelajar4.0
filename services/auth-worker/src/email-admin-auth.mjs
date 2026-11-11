import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";

const STAGING_SUPABASE_ORIGIN = "https://ydamszdfsxqisanazdkb.supabase.co";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCESS_TOKEN_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

/** @type {string} */
let cachedJwksUrl = "";
/** @type {ReturnType<typeof createRemoteJWKSet> | null} */
let cachedJwks = null;

export class BetterAuthAdminAuthError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "BetterAuthAdminAuthError";
    this.code = code;
  }
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

/** @param {string} value */
function stagingSupabaseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_ADMIN_NOT_CONFIGURED");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== STAGING_SUPABASE_ORIGIN ||
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
 * UserInfo, then check admin membership only in the isolated FREE Supabase
 * staging project using the service key held by this Worker.
 *
 * @param {{
 *   accessToken:string,
 *   authBaseUrl:string,
 *   resourceAudience:string,
 *   supabaseUrl:string,
 *   publishableKey:string,\n *   allowUnverifiedEmail?:boolean,
 *   fetchImpl?:typeof fetch,
 *   verifyJwtImpl?:typeof jwtVerify,
 *   createJwksImpl?:typeof createRemoteJWKSet,
 *   nowSeconds?:number
 * }} input
 */
export async function resolveBetterAuthAdminIdentity(input) {
  const accessToken = typeof input?.accessToken === "string" ? input.accessToken.trim() : "";
  const resourceAudience = typeof input?.resourceAudience === "string" ? input.resourceAudience.trim() : "";
  const publishableKey = typeof input?.publishableKey === "string" ? input.publishableKey.trim() : "";\n  const allowUnverifiedEmail = input?.allowUnverifiedEmail === true;
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
  const supabaseOrigin = stagingSupabaseOrigin(input.supabaseUrl);
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
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_INVALID");
  }
  if (
    protectedHeader.alg !== "ES256" ||
    typeof protectedHeader.kid !== "string" ||
    !protectedHeader.kid.trim()
  ) {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_INVALID");
  }

  let payload;
  try {
    if (!cachedJwks || cachedJwksUrl !== jwksUrl || input.createJwksImpl) {
      cachedJwksUrl = jwksUrl;
      cachedJwks = createJwksImpl(new URL(jwksUrl), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });
    }
    const verified = await verifyJwtImpl(accessToken, cachedJwks, {
      issuer,
      audience: resourceAudience,
      algorithms: ["ES256"],
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    payload = verified.payload;
  } catch {
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_INVALID");
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
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_INVALID");
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
    throw new BetterAuthAdminAuthError("BETTER_AUTH_RESOURCE_TOKEN_INVALID");
  }

  const userInfo = await userInfoResponse.json().catch(() => null);
  const email = typeof userInfo?.email === "string" ? userInfo.email.trim() : "";
  if (
    userInfo?.sub !== payload.sub ||
    userInfo?.email_verified !== true ||
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

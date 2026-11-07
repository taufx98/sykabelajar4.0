import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_AUTHORIZATION_ENDPOINT = "https://oauth.telegram.org/auth";
const TELEGRAM_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
const TELEGRAM_JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const START_COOLDOWN_MS = 60 * 1000;
const PHONE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const TELEGRAM_SUBJECT_PATTERN = /^[0-9]{1,32}$/;

/** @param {Uint8Array} bytes */
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** @param {string} value */
async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** @param {string} value */
export async function sha256Hex(value) {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {unknown} value */
export function normalizeTelegramPhone(value) {
  if (typeof value !== "string") throw new Error("TELEGRAM_PHONE_INVALID");
  const normalized = value.trim();
  if (!normalized || normalized.length > 32) throw new Error("TELEGRAM_PHONE_INVALID");
  // Telegram's OIDC claim is an international number. It may be represented
  // with a leading '+' or as international digits without the plus sign.
  if (!/^\+?[0-9][0-9\s().-]*$/.test(normalized)) {
    throw new Error("TELEGRAM_PHONE_INVALID");
  }
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    throw new Error("TELEGRAM_PHONE_INVALID");
  }
  return { e164: "+" + digits, digits, digitsCount: digits.length };
}

/** @param {{clientId:string,redirectUri:string,state:string,nonce:string,codeChallenge:string}} options */
export function buildTelegramAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  nonce,
  codeChallenge,
}) {
  if (
    typeof clientId !== "string" || !/^[0-9]{1,32}$/.test(clientId) ||
    typeof state !== "string" || state.length < 40 ||
    typeof nonce !== "string" || nonce.length < 40 ||
    typeof codeChallenge !== "string" || codeChallenge.length !== 43
  ) {
    throw new Error("TELEGRAM_OIDC_CONFIGURATION_INVALID");
  }

  const callback = new URL(redirectUri);
  if (
    callback.protocol !== "https:" &&
    !(callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname))
  ) {
    throw new Error("TELEGRAM_REDIRECT_URI_NOT_ALLOWED");
  }
  if (callback.username || callback.password || callback.search || callback.hash) {
    throw new Error("TELEGRAM_REDIRECT_URI_NOT_ALLOWED");
  }

  const url = new URL(TELEGRAM_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callback.toString());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid phone");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** @param {string} authUrl */
export function getTelegramPhoneRedirectUri(authUrl) {
  let base;
  try {
    base = new URL(authUrl);
  } catch {
    throw new Error("BETTER_AUTH_URL_INVALID");
  }
  if (
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) ||
    base.username || base.password || base.search || base.hash ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new Error("BETTER_AUTH_URL_NOT_ALLOWED");
  }
  return new URL("/phone-verification/telegram/callback", base.origin).toString();
}

/** @param {import("./env").AuthWorkerEnv} env */
export function isTelegramPhoneVerificationConfigured(env) {
  return Boolean(
    typeof env?.AUTH_TELEGRAM_CLIENT_ID === "string" &&
    /^[0-9]{1,32}$/.test(env.AUTH_TELEGRAM_CLIENT_ID.trim()) &&
    typeof env?.AUTH_TELEGRAM_CLIENT_SECRET === "string" &&
    env.AUTH_TELEGRAM_CLIENT_SECRET.trim().length >= 8 &&
    typeof env?.BETTER_AUTH_URL === "string" &&
    env.BETTER_AUTH_URL.trim(),
  );
}

/** @param {import("./env").AuthWorkerEnv} env @param {string} userId @param {number} [now] */
export async function createTelegramPhoneChallenge(env, userId, now = Date.now()) {
  if (!isTelegramPhoneVerificationConfigured(env)) {
    throw new Error("TELEGRAM_PHONE_VERIFICATION_NOT_CONFIGURED");
  }
  if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("BETTER_AUTH_USER_ID_INVALID");
  }

  const clientId = env.AUTH_TELEGRAM_CLIENT_ID?.trim();
  if (!clientId || !env.AUTH_TELEGRAM_CLIENT_SECRET?.trim()) {
    throw new Error("TELEGRAM_PHONE_VERIFICATION_NOT_CONFIGURED");
  }

  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(32);
  const codeChallenge = base64Url(await sha256Bytes(codeVerifier));
  const stateHash = await sha256Hex(state);
  const redirectUri = getTelegramPhoneRedirectUri(env.BETTER_AUTH_URL);

  const prior = await env.DB.prepare(
    "SELECT created_at FROM auth_phone_verification_challenges WHERE user_id = ?1",
  ).bind(userId).first();
  if (prior && Number(prior.created_at) > now - START_COOLDOWN_MS) {
    throw new Error("TELEGRAM_PHONE_VERIFICATION_RATE_LIMITED");
  }

  const expiresAt = now + CHALLENGE_TTL_MS;
  const inserted = await env.DB.prepare(
    "INSERT INTO auth_phone_verification_challenges " +
    "(state_hash, user_id, nonce, code_verifier, created_at, expires_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
    "ON CONFLICT(user_id) DO UPDATE SET " +
    "state_hash = excluded.state_hash, nonce = excluded.nonce, " +
    "code_verifier = excluded.code_verifier, created_at = excluded.created_at, " +
    "expires_at = excluded.expires_at",
  ).bind(stateHash, userId, nonce, codeVerifier, now, expiresAt).run();

  if (!inserted?.success || (inserted.meta?.changes ?? 0) !== 1) {
    throw new Error("TELEGRAM_PHONE_CHALLENGE_UNAVAILABLE");
  }

  return {
    state,
    expiresAt,
    authorizationUrl: buildTelegramAuthorizationUrl({
      clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge,
    }),
  };
}

/**
 * Atomically consumes a challenge so duplicate callbacks cannot reuse it.
 * D1 supports DELETE ... RETURNING on the deployed SQLite engine.
 */
/** @param {import("./env").AuthWorkerEnv} env @param {string} state @param {number} [now] */
export async function consumeTelegramPhoneChallenge(env, state, now = Date.now()) {
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(state)) return null;
  const stateHash = await sha256Hex(state);
  return env.DB.prepare(
    "DELETE FROM auth_phone_verification_challenges " +
    "WHERE state_hash = ?1 AND expires_at > ?2 " +
    "RETURNING user_id, nonce, code_verifier, created_at, expires_at",
  ).bind(stateHash, now).first();
}

/** @param {{code:string,codeVerifier:string,clientId:string,clientSecret:string,redirectUri:string,fetchImpl?:typeof fetch}} options */
export async function exchangeTelegramAuthorizationCode({
  code,
  codeVerifier,
  clientId,
  clientSecret,
  redirectUri,
  fetchImpl = fetch,
}) {
  if (
    typeof code !== "string" || code.length < 8 || code.length > 4096 ||
    typeof codeVerifier !== "string" || codeVerifier.length < 43 ||
    typeof clientId !== "string" || typeof clientSecret !== "string"
  ) {
    throw new Error("TELEGRAM_TOKEN_EXCHANGE_INPUT_INVALID");
  }

  const credentials = btoa(clientId + ":" + clientSecret);
  let response;
  try {
    response = await fetchImpl(TELEGRAM_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Basic " + credentials,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("TELEGRAM_TOKEN_EXCHANGE_UNAVAILABLE");
  }

  if (!response.ok) throw new Error("TELEGRAM_TOKEN_EXCHANGE_REJECTED");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("TELEGRAM_TOKEN_RESPONSE_INVALID");
  }
  if (!payload || typeof payload.id_token !== "string" || payload.id_token.length > 16384) {
    throw new Error("TELEGRAM_ID_TOKEN_MISSING");
  }
  // Do not persist the access token or any other Telegram credential.
  return payload.id_token;
}

/** @param {{idToken:string,clientId:string,expectedNonce:string,now?:number,jwks?:Parameters<typeof jwtVerify>[1]}} options */
export async function verifyTelegramPhoneIdToken({
  idToken,
  clientId,
  expectedNonce,
  now = Date.now(),
  jwks,
} = {}) {
  if (
    typeof idToken !== "string" || idToken.length < 32 || idToken.length > 16384 ||
    typeof clientId !== "string" || !/^[0-9]{1,32}$/.test(clientId) ||
    typeof expectedNonce !== "string" || expectedNonce.length < 40
  ) {
    throw new Error("TELEGRAM_ID_TOKEN_INVALID");
  }

  const keySet = jwks ?? createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL));
  let payload;
  try {
    const verified = await jwtVerify(idToken, keySet, {
      issuer: TELEGRAM_ISSUER,
      audience: clientId,
      algorithms: ["RS256"],
      requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
      clockTolerance: 30,
    });
    payload = verified.payload;
  } catch {
    throw new Error("TELEGRAM_ID_TOKEN_SIGNATURE_OR_CLAIMS_INVALID");
  }

  if (payload.nonce !== expectedNonce) {
    throw new Error("TELEGRAM_ID_TOKEN_NONCE_INVALID");
  }
  if (
    typeof payload.sub !== "string" ||
    !TELEGRAM_SUBJECT_PATTERN.test(payload.sub) ||
    payload.phone_number_verified !== true ||
    typeof payload.phone_number !== "string"
  ) {
    throw new Error("TELEGRAM_PHONE_NOT_VERIFIED");
  }

  const issuedAt = Number(payload.iat) * 1000;
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > 10 * 60_000) {
    throw new Error("TELEGRAM_ID_TOKEN_TOO_OLD");
  }

  const phone = normalizeTelegramPhone(payload.phone_number);
  return {
    provider: "telegram",
    providerSubject: payload.sub,
    phoneE164: phone.e164,
    phoneDigits: phone.digits,
    phoneDigitsCount: phone.digitsCount,
  };
}

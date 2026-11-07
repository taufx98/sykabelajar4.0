import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import {
  buildTelegramAuthorizationUrl,
  consumeTelegramPhoneChallenge,
  createTelegramPhoneChallenge,
  exchangeTelegramAuthorizationCode,
  isTelegramPhoneVerificationConfigured,
  normalizeTelegramPhone,
  sha256Hex,
  verifyTelegramPhoneIdToken,
} from "../src/telegram-phone-verification.mjs";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "123456789";
const CLIENT_SECRET = "test-telegram-client-secret";
const NONCE = "n".repeat(43);

function createD1Mock({ existing = null, changes = 1, consumed = null } = {}) {
  const calls = [];
  const DB = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async first() {
              calls.push({ method: "first", query: String(query), values });
              return String(query).startsWith("SELECT created_at")
                ? existing
                : consumed;
            },
            async run() {
              calls.push({ method: "run", query: String(query), values });
              return { success: true, meta: { changes } };
            },
          };
        },
      };
    },
  };
  return { DB, calls };
}

test("Telegram configuration is opt-in and never enabled by missing values", () => {
  assert.equal(isTelegramPhoneVerificationConfigured({}), false);
  assert.equal(isTelegramPhoneVerificationConfigured({
    AUTH_TELEGRAM_CLIENT_ID: CLIENT_ID,
    AUTH_TELEGRAM_CLIENT_SECRET: CLIENT_SECRET,
    BETTER_AUTH_URL: "https://auth.sykabelajar.my.id",
  }), true);
  assert.equal(isTelegramPhoneVerificationConfigured({
    AUTH_TELEGRAM_CLIENT_ID: "not-a-number",
    AUTH_TELEGRAM_CLIENT_SECRET: CLIENT_SECRET,
    BETTER_AUTH_URL: "https://auth.sykabelajar.my.id",
  }), false);
});

test("authorization URL requests only openid and phone with state, nonce and PKCE S256", () => {
  const url = new URL(buildTelegramAuthorizationUrl({
    clientId: CLIENT_ID,
    redirectUri: "https://auth.sykabelajar.my.id/phone-verification/telegram/callback",
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    codeChallenge: "c".repeat(43),
  }));
  assert.equal(url.origin, "https://oauth.telegram.org");
  assert.equal(url.pathname, "/auth");
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("scope"), "openid phone");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "s".repeat(43));
  assert.equal(url.searchParams.get("nonce"), "n".repeat(43));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("callback URL rejects non-HTTPS remote URLs and query injection", () => {
  assert.throws(() => buildTelegramAuthorizationUrl({
    clientId: CLIENT_ID,
    redirectUri: "https://attacker.invalid/callback?next=https://evil.invalid",
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    codeChallenge: "c".repeat(43),
  }), /TELEGRAM_REDIRECT_URI_NOT_ALLOWED/);
  assert.throws(() => buildTelegramAuthorizationUrl({
    clientId: CLIENT_ID,
    redirectUri: "http://attacker.invalid/callback",
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    codeChallenge: "c".repeat(43),
  }), /TELEGRAM_REDIRECT_URI_NOT_ALLOWED/);
});

test("phone normalization accepts only international 8–15 digit phone claims", () => {
  assert.deepEqual(normalizeTelegramPhone("+62 812-3456-7890"), {
    e164: "+6281234567890",
    digits: "6281234567890",
    digitsCount: 13,
  });
  assert.deepEqual(normalizeTelegramPhone("971577777777"), {
    e164: "+971577777777",
    digits: "971577777777",
    digitsCount: 12,
  });
  for (const value of [
    "",
    "081234567890",
    "1234567",
    "1234567890123456",
    "+62abc12345678",
    "+62 812/3456",
    null,
    6281234567890,
  ]) {
    assert.throws(() => normalizeTelegramPhone(value));
  }
});

test("SHA-256 matches the legacy digits-only organizer identity hash contract", async () => {
  assert.equal(
    await sha256Hex("6281234567890"),
    "7b44a0833f1b3b1f6f5f9d2d4fd3a0e2a1b8eac59f8a9a1bbd2a5fbb6c3a9f8c",
  );
});

test("challenge stores only a state hash and one-time nonce/PKCE verifier in D1", async () => {
  const d1 = createD1Mock();
  const result = await createTelegramPhoneChallenge({
    DB: d1.DB,
    AUTH_TELEGRAM_CLIENT_ID: CLIENT_ID,
    AUTH_TELEGRAM_CLIENT_SECRET: CLIENT_SECRET,
    BETTER_AUTH_URL: "https://auth.sykabelajar.my.id",
  }, USER_ID, 1_800_000_000_000);
  assert.equal(new URL(result.authorizationUrl).searchParams.get("state"), result.state);
  assert.equal(d1.calls.length, 2);
  assert.match(d1.calls[0].query, /SELECT created_at/);
  assert.match(d1.calls[1].query, /ON CONFLICT\(user_id\) DO UPDATE/);
  assert.equal(d1.calls[1].values[0], await sha256Hex(result.state));
  assert.notEqual(d1.calls[1].values[0], result.state);
  assert.equal(d1.calls[1].values[1], USER_ID);
  assert.equal(d1.calls[1].values[2].length, 43);
  assert.equal(d1.calls[1].values[3].length, 43);
});

test("challenge start is rate limited and never overwrites a recent active challenge", async () => {
  const d1 = createD1Mock({ existing: { created_at: 1_800_000_000_000 - 1000 } });
  await assert.rejects(
    createTelegramPhoneChallenge({
      DB: d1.DB,
      AUTH_TELEGRAM_CLIENT_ID: CLIENT_ID,
      AUTH_TELEGRAM_CLIENT_SECRET: CLIENT_SECRET,
      BETTER_AUTH_URL: "https://auth.sykabelajar.my.id",
    }, USER_ID, 1_800_000_000_000),
    /TELEGRAM_PHONE_VERIFICATION_RATE_LIMITED/,
  );
  assert.equal(d1.calls.length, 1);
});

test("challenge consumption hashes state and uses one atomic delete-returning statement", async () => {
  const d1 = createD1Mock({ consumed: { user_id: USER_ID, nonce: NONCE, code_verifier: "v".repeat(43) } });
  const result = await consumeTelegramPhoneChallenge(d1.DB ? { DB: d1.DB } : {}, "s".repeat(43), 123);
  assert.equal(result.user_id, USER_ID);
  assert.match(d1.calls[0].query, /DELETE FROM auth_phone_verification_challenges/);
  assert.match(d1.calls[0].query, /RETURNING user_id, nonce, code_verifier/);
  assert.equal(d1.calls[0].values[0], await sha256Hex("s".repeat(43)));
  assert.equal(d1.calls[0].values[1], 123);
});

test("malformed and expired state values never reach D1", async () => {
  const d1 = createD1Mock();
  assert.equal(await consumeTelegramPhoneChallenge({ DB: d1.DB }, "bad", 123), null);
  assert.equal(d1.calls.length, 0);
});

test("authorization code exchange uses Basic auth and does not return access tokens", async () => {
  let call;
  const idToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
  const result = await exchangeTelegramAuthorizationCode({
    code: "authorization-code",
    codeVerifier: "v".repeat(43),
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: "https://auth.sykabelajar.my.id/phone-verification/telegram/callback",
    fetchImpl: async (url, init) => {
      call = { url, init };
      return new Response(JSON.stringify({
        access_token: "must-not-be-stored",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      }), { status: 200 });
    },
  });
  assert.equal(result, idToken);
  assert.equal(call.url, "https://oauth.telegram.org/token");
  assert.equal(call.init.headers.Authorization, "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET));
  assert.match(String(call.init.body), /code_verifier=/);
});

test("token exchange failures expose only stable errors", async () => {
  await assert.rejects(exchangeTelegramAuthorizationCode({
    code: "authorization-code",
    codeVerifier: "v".repeat(43),
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: "https://auth.sykabelajar.my.id/phone-verification/telegram/callback",
    fetchImpl: async () => { throw new Error("sensitive token endpoint response"); },
  }), (error) => error.message === "TELEGRAM_TOKEN_EXCHANGE_UNAVAILABLE");
});

test("Telegram ID token requires a valid RS256 signature, issuer, audience, nonce, and verified phone claim", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "telegram-test-kid";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    nonce: NONCE,
    phone_number: "6281234567890",
    phone_number_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "telegram-test-kid" })
    .setIssuer("https://oauth.telegram.org")
    .setAudience(CLIENT_ID)
    .setSubject("987654321")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
  const claims = await verifyTelegramPhoneIdToken({
    idToken: token, clientId: CLIENT_ID, expectedNonce: NONCE, jwks, now: Date.now(),
  });
  assert.deepEqual(claims, {
    provider: "telegram",
    providerSubject: "987654321",
    phoneE164: "+6281234567890",
    phoneDigits: "6281234567890",
    phoneDigitsCount: 13,
  });
});

test("Telegram ID token rejects wrong issuer, audience, nonce and unverified phone claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "telegram-test-kid";
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1000);
  async function makeToken(overrides = {}) {
    const { nonce = NONCE, phone_number_verified = true, issuer = "https://oauth.telegram.org", audience = CLIENT_ID } = overrides;
    return new SignJWT({ nonce, phone_number: "6281234567890", phone_number_verified })
      .setProtectedHeader({ alg: "RS256", kid: "telegram-test-kid" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("987654321")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
  for (const [overrides, error] of [
    [{ issuer: "https://attacker.invalid" }, /TELEGRAM_ID_TOKEN_SIGNATURE_OR_CLAIMS_INVALID/],
    [{ audience: "999999999" }, /TELEGRAM_ID_TOKEN_SIGNATURE_OR_CLAIMS_INVALID/],
    [{ nonce: "wrong" }, /TELEGRAM_ID_TOKEN_NONCE_INVALID/],
    [{ phone_number_verified: false }, /TELEGRAM_PHONE_NOT_VERIFIED/],
  ]) {
    await assert.rejects(verifyTelegramPhoneIdToken({
      idToken: await makeToken(overrides), clientId: CLIENT_ID,
      expectedNonce: NONCE, jwks, now: Date.now(),
    }), error);
  }
});

test("Telegram ID token rejects expired, stale, and malformed tokens", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "telegram-test-kid";
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({
    nonce: NONCE, phone_number: "6281234567890", phone_number_verified: true,
  }).setProtectedHeader({ alg: "RS256", kid: "telegram-test-kid" })
    .setIssuer("https://oauth.telegram.org").setAudience(CLIENT_ID).setSubject("987654321")
    .setIssuedAt(now - 1200).setExpirationTime(now - 900).sign(privateKey);
  await assert.rejects(verifyTelegramPhoneIdToken({
    idToken: expired, clientId: CLIENT_ID, expectedNonce: NONCE, jwks, now: Date.now(),
  }), /TELEGRAM_ID_TOKEN_SIGNATURE_OR_CLAIMS_INVALID/);

  const stale = await new SignJWT({
    nonce: NONCE, phone_number: "6281234567890", phone_number_verified: true,
  }).setProtectedHeader({ alg: "RS256", kid: "telegram-test-kid" })
    .setIssuer("https://oauth.telegram.org").setAudience(CLIENT_ID).setSubject("987654321")
    .setIssuedAt(now - 700).setExpirationTime(now + 300).sign(privateKey);
  await assert.rejects(verifyTelegramPhoneIdToken({
    idToken: stale, clientId: CLIENT_ID, expectedNonce: NONCE, jwks, now: Date.now(),
  }), /TELEGRAM_ID_TOKEN_TOO_OLD/);

  await assert.rejects(verifyTelegramPhoneIdToken({
    idToken: "not-a-jwt", clientId: CLIENT_ID, expectedNonce: NONCE, jwks, now: Date.now(),
  }), /TELEGRAM_ID_TOKEN_INVALID/);
});

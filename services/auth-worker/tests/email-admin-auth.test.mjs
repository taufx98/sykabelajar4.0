import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { readFileSync } from "node:fs";
import {
  BetterAuthAdminAuthError,
  isBetterAuthTokenForIssuer,
  resolveBetterAuthAdminIdentity,
} from "../src/email-admin-auth.mjs";

const ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const AUTH_BASE_URL = "https://auth.sykabelajar.my.id";
const RESOURCE = "https://sykabelajar.my.id";
const SUPABASE_URL = "https://ydamszdfsxqisanazdkb.supabase.co";
const SERVICE_KEY = "staging-service-role-key-not-for-browser";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = 1_800_000_000;
const emailAdminSource = readFileSync(new URL("../src/email-admin.ts", import.meta.url), "utf8");

function fakeToken(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "staging-key-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    sub: USER_ID,
    aud: [RESOURCE, ISSUER + "/oauth2/userinfo"],
    role: "authenticated",
    scope: "openid profile email",
    iat: NOW - 10,
    exp: NOW + 290,
    ...claims,
  })).toString("base64url");
  return header + "." + payload + ".signature";
}

function makeFetch({ userInfo, roles, failUserInfo = false, failRoles = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === ISSUER + "/oauth2/userinfo") {
      if (failUserInfo) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify(userInfo ?? {
        sub: USER_ID,
        email: "admin@example.test",
        email_verified: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).startsWith(SUPABASE_URL + "/rest/v1/user_roles?")) {
      if (failRoles) return new Response("error", { status: 503 });
      return new Response(JSON.stringify(roles ?? [
        { user_id: USER_ID, role: "admin", is_active: true },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected network target");
  };
  return { fetchImpl, calls };
}

function verifyStub(payload) {
  return async (token, keySet, options) => {
    assert.equal(typeof token, "string");
    assert.ok(keySet);
    assert.equal(options.issuer, ISSUER);
    assert.equal(options.audience, RESOURCE);
    assert.deepEqual(options.algorithms, ["ES256"]);
    return { payload };
  };
}

function input(overrides = {}) {
  const token = fakeToken();
  return {
    accessToken: token,
    authBaseUrl: AUTH_BASE_URL,
    resourceAudience: RESOURCE,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_KEY,
    nowSeconds: NOW,
    verifyJwtImpl: verifyStub({
      iss: ISSUER,
      sub: USER_ID,
      aud: [RESOURCE, ISSUER + "/oauth2/userinfo"],
      role: "authenticated",
      iat: NOW - 10,
      exp: NOW + 290,
    }),
    createJwksImpl: () => ({ stagingJwks: true }),
    ...overrides,
  };
}

test("only the exact Better Auth issuer selects the external-token verifier", () => {
  assert.equal(isBetterAuthTokenForIssuer(fakeToken(), AUTH_BASE_URL), true);
  assert.equal(isBetterAuthTokenForIssuer(fakeToken({ iss: "https://attacker.invalid" }), AUTH_BASE_URL), false);
  assert.equal(isBetterAuthTokenForIssuer("not-a-jwt", AUTH_BASE_URL), false);
});

test("Better Auth admin identity is signature-contract verified, UserInfo verified and role checked in staging", async () => {
  const network = makeFetch();
  const user = await resolveBetterAuthAdminIdentity(input({ fetchImpl: network.fetchImpl }));
  assert.deepEqual(user, { id: USER_ID, email: "admin@example.test" });
  assert.equal(network.calls.length, 2);

  const infoCall = network.calls[0];
  assert.equal(infoCall.url, ISSUER + "/oauth2/userinfo");
  assert.equal(infoCall.init.headers.Authorization, "Bearer " + fakeToken());

  const roleCall = network.calls[1];
  const roleUrl = new URL(roleCall.url);
  assert.equal(roleUrl.origin, SUPABASE_URL);
  assert.equal(roleUrl.pathname, "/rest/v1/user_roles");
  assert.equal(roleUrl.searchParams.get("user_id"), "eq." + USER_ID);
  assert.equal(roleUrl.searchParams.get("role"), "eq.admin");
  assert.equal(roleUrl.searchParams.get("is_active"), "eq.true");
  assert.equal(roleCall.init.headers.apikey, SERVICE_KEY);
  assert.equal(roleCall.init.headers.Authorization, "Bearer " + SERVICE_KEY);
});

test("JWT business role, subject and maximum lifetime are independently guarded", async () => {
  for (const payload of [
    { role: "admin" },
    { sub: "not-a-uuid" },
    { exp: NOW + 600 },
    { iat: NOW + 120 },
    { aud: "https://evil.invalid" },
    { iss: "https://attacker.invalid" },
  ]) {
    const network = makeFetch();
    await assert.rejects(
      resolveBetterAuthAdminIdentity(input({
        fetchImpl: network.fetchImpl,
        verifyJwtImpl: verifyStub({
          iss: ISSUER,
          sub: USER_ID,
          aud: RESOURCE,
          role: "authenticated",
          iat: NOW - 10,
          exp: NOW + 290,
          ...payload,
        }),
      })),
      (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_RESOURCE_TOKEN_INVALID",
    );
    assert.equal(network.calls.length, 0, "invalid JWT claims must fail before network calls");
  }
});

test("the production verifier validates an actual ES256 signature against the issuer JWKS key", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const token = await new SignJWT({ role: "authenticated", scope: "openid profile email" })
    .setProtectedHeader({ alg: "ES256", kid: "staging-key-1", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(USER_ID)
    .setAudience([RESOURCE, ISSUER + "/oauth2/userinfo"])
    .setIssuedAt(NOW - 10)
    .setExpirationTime(NOW + 290)
    .sign(privateKey);

  const network = makeFetch();
  const user = await resolveBetterAuthAdminIdentity(input({
    accessToken: token,
    fetchImpl: network.fetchImpl,
    verifyJwtImpl: undefined,
    createJwksImpl: (url) => {
      assert.equal(url.toString(), ISSUER + "/jwks");
      return publicKey;
    },
  }));
  assert.deepEqual(user, { id: USER_ID, email: "admin@example.test" });

  const [signedHeader, signedPayload, encodedSignature] = token.split(".");
  const signatureBytes = Buffer.from(encodedSignature, "base64url");
  signatureBytes[0] ^= 0x01;
  const tampered = [signedHeader, signedPayload, signatureBytes.toString("base64url")].join(".");
  const tamperedNetwork = makeFetch();
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({
      accessToken: tampered,
      fetchImpl: tamperedNetwork.fetchImpl,
      verifyJwtImpl: undefined,
      createJwksImpl: () => publicKey,
    })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_RESOURCE_TOKEN_INVALID",
  );
  assert.equal(tamperedNetwork.calls.length, 0, "bad signatures must be rejected before UserInfo or Supabase");
});

test("UserInfo must match the verified subject and report verified email", async () => {
  for (const userInfo of [
    { sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "admin@example.test", email_verified: true },
    { sub: USER_ID, email: "admin@example.test", email_verified: false },
    { sub: USER_ID, email: "not-an-email", email_verified: true },
  ]) {
    const network = makeFetch({ userInfo });
    await assert.rejects(
      resolveBetterAuthAdminIdentity(input({ fetchImpl: network.fetchImpl })),
      (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_USERINFO_INVALID",
    );
    assert.equal(network.calls.length, 1, "invalid UserInfo must not trigger an admin role query");
  }
});

test("service-side role resolution fails closed for non-admin and cannot target production Supabase", async () => {
  const network = makeFetch({ roles: [{ user_id: USER_ID, role: "admin", is_active: false }] });
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({ fetchImpl: network.fetchImpl })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_ADMIN_REQUIRED",
  );

  const noNetwork = makeFetch();
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({
      supabaseUrl: "https://mvdczyitbkxkldjughor.supabase.co",
      fetchImpl: noNetwork.fetchImpl,
    })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_ADMIN_PROJECT_NOT_ALLOWED",
  );
  assert.equal(noNetwork.calls.length, 0);
});

test("missing staging server key and unavailable UserInfo/role services fail closed", async () => {
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({ serviceRoleKey: "" })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_ADMIN_NOT_CONFIGURED",
  );

  const userInfoDown = makeFetch({ failUserInfo: true });
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({ fetchImpl: userInfoDown.fetchImpl })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_RESOURCE_TOKEN_INVALID",
  );
  assert.equal(userInfoDown.calls.length, 1);

  const rolesDown = makeFetch({ failRoles: true });
  await assert.rejects(
    resolveBetterAuthAdminIdentity(input({ fetchImpl: rolesDown.fetchImpl })),
    (error) => error instanceof BetterAuthAdminAuthError && error.code === "BETTER_AUTH_ADMIN_CHECK_FAILED",
  );
  assert.equal(rolesDown.calls.length, 2);
});

test("email admin route verifies Better Auth separately and keeps the Supabase Auth default path", () => {
  assert.match(emailAdminSource, /isBetterAuthTokenForIssuer\(accessToken, env\.BETTER_AUTH_URL\)/);
  assert.match(emailAdminSource, /resolveBetterAuthAdminIdentity\(/);
  assert.match(emailAdminSource, /supabaseBaseUrl\(env\)/);
  assert.match(emailAdminSource, /\/auth\/v1\/user/);
  assert.match(emailAdminSource, /\/rest\/v1\/rpc\/is_active_admin/);
  assert.match(emailAdminSource, /SUPABASE_PROVISIONING_URL/);
  assert.match(emailAdminSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(emailAdminSource, /BETTER_AUTH_ADMIN_REQUIRED/);
});


test("email settings GET requires an active admin and projects no provider credential", () => {
  const listStart = emailAdminSource.indexOf("async function listSettings");
  const saveStart = emailAdminSource.indexOf("async function saveAccount", listStart);
  assert.ok(listStart >= 0 && saveStart > listStart);
  const projection = emailAdminSource.slice(listStart, saveStart);

  assert.match(emailAdminSource, /export async function handleEmailAdminRequest/);
  const handlerStart = emailAdminSource.indexOf("export async function handleEmailAdminRequest");
  const handler = emailAdminSource.slice(handlerStart);
  assert.match(handler, /const authorization = await requireActiveAdmin\(request, env\)/);
  assert.ok(
    handler.indexOf("requireActiveAdmin(request, env)") < handler.indexOf('if (request.method === "GET")'),
    "GET must authenticate and authorize an active admin before reading settings",
  );
  assert.match(projection, /CASE WHEN length\(send_mail_token_ciphertext\) > 0 THEN 1 ELSE 0 END AS token_configured/);
  for (const field of [
    "id", "label", "provider", "sender_address", "sender_name",
    "bounce_address", "token_configured", "created_at", "updated_at",
  ]) assert.match(projection, new RegExp("\\b" + field + "\\b"));
  assert.doesNotMatch(projection, /SELECT[^;]*send_mail_token_ciphertext\s*(?:,|FROM)/s,
    "GET must not select provider ciphertext as a response field");
  assert.match(projection, /tokenConfigured: row\.token_configured === 1/);
  assert.doesNotMatch(projection, /sendMailToken|send_mail_token_ciphertext\s*:/);
});

test("saving email provider credentials encrypts new tokens before D1 and preserves only existing ciphertext", () => {
  const start = emailAdminSource.indexOf("async function saveAccount");
  const end = emailAdminSource.indexOf("async function activateAccount", start);
  assert.ok(start >= 0 && end > start);
  const save = emailAdminSource.slice(start, end);
  assert.match(save, /let tokenCiphertext = existing\?\.send_mail_token_ciphertext \?\? ""/);
  assert.match(save, /tokenCiphertext = await encryptEmailSecret\(env\.AUTH_EMAIL_ENCRYPTION_KEY, submittedToken\)/);
  const encryption = save.indexOf("encryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, submittedToken)");
  const write = save.indexOf(".bind(id, label, provider, senderAddress, senderName, bounceAddress || null, tokenCiphertext");
  assert.ok(encryption >= 0 && write > encryption, "new email provider tokens must be encrypted before the database write");
  assert.doesNotMatch(save, /\.bind\([^;]*submittedToken/);
});

test("activating email accounts validates the encrypted credential before switching the active account", () => {
  const start = emailAdminSource.indexOf("async function activateAccount");
  const end = emailAdminSource.indexOf("async function deleteAccount", start);
  assert.ok(start >= 0 && end > start);
  const activate = emailAdminSource.slice(start, end);
  assert.match(activate, /SELECT send_mail_token_ciphertext FROM auth_email_accounts/);
  assert.match(activate, /decryptEmailSecret\(env\.AUTH_EMAIL_ENCRYPTION_KEY, candidate\.send_mail_token_ciphertext\)/);
  const verify = activate.indexOf("decryptEmailSecret(");
  const switchActive = activate.indexOf("UPDATE auth_email_settings SET active_account_id");
  assert.ok(verify >= 0 && switchActive > verify, "active account must not change until its stored token decrypts");
  assert.match(activate, /EMAIL_ACCOUNT_SECRET_UNAVAILABLE/);
});

test("active email accounts cannot be deleted and admin test mail is rate-limited to the signed-in admin", () => {
  const deleteStart = emailAdminSource.indexOf("async function deleteAccount");
  const testStart = emailAdminSource.indexOf("async function testAccount", deleteStart);
  const routeStart = emailAdminSource.indexOf("export async function handleEmailAdminRequest");
  assert.ok(deleteStart >= 0 && testStart > deleteStart && routeStart > testStart);
  const deleteAccount = emailAdminSource.slice(deleteStart, testStart);
  const testAccount = emailAdminSource.slice(testStart, routeStart);

  assert.match(deleteAccount, /SELECT active_account_id FROM auth_email_settings/);
  assert.match(deleteAccount, /active_account_id === id/);
  assert.match(deleteAccount, /ACTIVE_EMAIL_ACCOUNT_CANNOT_BE_DELETED/);
  const activeCheck = deleteAccount.indexOf("active_account_id === id");
  const deleteWrite = deleteAccount.indexOf("DELETE FROM auth_email_accounts");
  assert.ok(activeCheck >= 0 && deleteWrite > activeCheck, "the active account guard must run before deletion");

  assert.match(testAccount, /INSERT INTO auth_email_admin_test_limits/);
  assert.match(testAccount, /last_sent_at <= \?3 RETURNING user_id/);
  assert.match(testAccount, /\.bind\(user\.id, now, now - 60\)/);
  assert.match(testAccount, /to: user\.email/);
  assert.match(testAccount, /EMAIL_TEST_RATE_LIMITED/);
  assert.match(testAccount, /account\.send_mail_token_ciphertext/);
  assert.doesNotMatch(testAccount, /to:\s*body\./,
    "admin test email recipient must come from the verified admin identity, never request input");
});

console.log("Better Auth email-admin bridge verification tests passed.");

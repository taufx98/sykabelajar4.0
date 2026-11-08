import assert from "node:assert/strict";
import test from "node:test";
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

console.log("Better Auth email-admin bridge verification tests passed.");

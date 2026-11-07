import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const authOrigin = "https://auth.sykabelajar.my.id";
const authBase = authOrigin + "/api/auth";
const issuer = authBase;
const appOrigin = "https://sykabelajar.my.id";
const callbackUrl = appOrigin + "/auth/oidc/callback";
const audience = appOrigin;
const clientId = "sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y";
const supabaseUrl = process.env.SUPABASE_STAGING_URL;
const publishableKey = process.env.SUPABASE_STAGING_PUBLISHABLE_KEY;
const acceptanceToken = process.env.OIDC_ACCEPTANCE_TEST_TOKEN;

assert.ok(supabaseUrl === "https://ydamszdfsxqisanazdkb.supabase.co", "must target the isolated staging project");
assert.ok(publishableKey?.startsWith("sb_publishable_"), "staging publishable key is required");
assert.ok(acceptanceToken && acceptanceToken.length >= 32, "temporary acceptance secret is required");

const acceptanceHeaders = {
  Authorization: "Bearer " + acceptanceToken,
};

async function parseJson(response, label) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(label + " returned non-JSON HTTP " + response.status);
  }
}

async function bootstrapSyntheticUsers() {
  const response = await fetch(authOrigin + "/_internal/oidc-acceptance/bootstrap", {
    method: "POST",
    headers: acceptanceHeaders,
    redirect: "error",
  });
  assert.equal(response.status, 200, "staging-only synthetic session bootstrap must succeed");
  const payload = await parseJson(response, "OIDC acceptance bootstrap");
  assert.ok(Array.isArray(payload?.users) && payload.users.length === 2, "exactly two synthetic users must be created");
  for (const user of payload.users) {
    assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(typeof user.cookie, "string");
    assert.ok(user.cookie.includes("="), "signed Better Auth session cookie is required");
  }
  assert.deepEqual(
    payload.users.map((user) => user.id).sort(),
    [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].sort(),
    "synthetic user UUIDs must match only the dedicated staging RLS fixture",
  );
  return payload.users;
}

async function getDiscoveryAndJwks() {
  const response = await fetch(authBase + "/.well-known/openid-configuration", { redirect: "error" });
  assert.equal(response.status, 200, "hosted discovery must respond 200");
  const discovery = await parseJson(response, "OIDC discovery");
  assert.equal(discovery.issuer, issuer, "hosted issuer must match the exact registered issuer");
  assert.ok(discovery.code_challenge_methods_supported?.includes("S256"), "hosted issuer must advertise PKCE S256");
  assert.ok(typeof discovery.jwks_uri === "string" && discovery.jwks_uri.startsWith(authOrigin + "/"));
  const jwksResponse = await fetch(discovery.jwks_uri, { redirect: "error" });
  assert.equal(jwksResponse.status, 200, "hosted JWKS must respond 200");
  const jwks = await parseJson(jwksResponse, "hosted JWKS");
  assert.ok(
    jwks.keys?.some((key) =>
      key.kty === "EC" && key.crv === "P-256" && key.alg === "ES256" &&
      typeof key.kid === "string" && key.kid.length > 0 && !Object.hasOwn(key, "d")
    ),
    "JWKS must publish only a public ES256 P-256 key",
  );
  return { discovery, remoteJwks: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
}

async function mintAccessToken(cookie, discovery) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  const nonce = randomUUID();
  const authorizeParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid profile email",
    resource: audience,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authorizeResponse = await fetch(
    authBase + "/oauth2/authorize?" + authorizeParams.toString(),
    {
      redirect: "manual",
      headers: {
        Origin: appOrigin,
        Cookie: cookie,
        Accept: "text/html,application/json",
      },
    },
  );

  const locationHeader = authorizeResponse.headers.get("location");
  let redirectLocation = locationHeader;
  if (!redirectLocation) {
    const responsePayload = await parseJson(authorizeResponse, "OAuth authorization");
    if (responsePayload?.redirect === true && typeof responsePayload.url === "string") {
      redirectLocation = responsePayload.url;
    }
  }
  assert.ok(redirectLocation, "valid PKCE request must return an authorization redirect");
  const callback = new URL(redirectLocation, authOrigin);
  assert.equal(callback.origin, new URL(callbackUrl).origin, "callback origin must match exactly");
  assert.equal(callback.pathname, new URL(callbackUrl).pathname, "callback path must match exactly");
  assert.equal(callback.searchParams.get("state"), state, "OAuth state must be preserved");
  assert.equal(callback.searchParams.get("iss"), discovery.issuer, "authorization response must include RFC 9207 issuer");
  assert.equal(callback.searchParams.get("error"), null, "OAuth authorization must not return an error");
  const code = callback.searchParams.get("code");
  assert.ok(code, "authorization must issue an authorization code");

  const tokenResponse = await fetch(authBase + "/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: appOrigin,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      code,
      code_verifier: verifier,
      resource: audience,
    }),
  });
  assert.equal(tokenResponse.status, 200, "valid PKCE authorization code must exchange successfully");
  const tokens = await parseJson(tokenResponse, "OAuth token exchange");
  assert.ok(tokens?.access_token, "access token must be issued");
  assert.equal(tokens.token_type?.toLowerCase(), "bearer");
  assert.equal(tokens.refresh_token, undefined, "this public Supabase client must not receive a refresh token");
  assert.ok(tokens.id_token, "openid scope must issue an ID token");

  const access = await jwtVerify(tokens.access_token, discovery.remoteJwks ?? createRemoteJWKSet(new URL(discovery.jwks_uri)), {
    issuer,
    audience,
  });
  assert.equal(access.protectedHeader.alg, "ES256");
  assert.ok(access.protectedHeader.kid);
  assert.equal(access.payload.role, "authenticated");
  assert.match(String(access.payload.sub), /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(
    Number.isInteger(access.payload.iat) &&
    Number.isInteger(access.payload.exp) &&
    access.payload.exp > access.payload.iat &&
    access.payload.exp - access.payload.iat <= 300,
    "access token must expire within 300 seconds",
  );

  const idToken = await jwtVerify(tokens.id_token, discovery.remoteJwks ?? createRemoteJWKSet(new URL(discovery.jwks_uri)), {
    issuer,
    audience: clientId,
  });
  assert.equal(idToken.protectedHeader.alg, "ES256");
  assert.equal(idToken.payload.sub, access.payload.sub);
  assert.equal(idToken.payload.nonce, nonce, "ID token nonce must match the original authorization request");
  return { accessToken: tokens.access_token, userId: String(access.payload.sub) };
}

async function readFixtureRows(accessToken) {
  const url = new URL("/rest/v1/auth_oidc_acceptance_rows", supabaseUrl);
  url.searchParams.set("select", "id,owner_id,note");
  url.searchParams.set("order", "owner_id.asc");
  const response = await fetch(url, {
    headers: {
      apikey: publishableKey,
      Authorization: "Bearer " + accessToken,
    },
  });
  assert.equal(response.status, 200, "Supabase Data API must accept the Better Auth JWT");
  const rows = await parseJson(response, "Supabase RLS fixture query");
  assert.ok(Array.isArray(rows), "fixture query must return an array");
  return rows;
}

async function assertRejectedCrossUserInsert(accessToken, otherUserId) {
  const response = await fetch(new URL("/rest/v1/auth_oidc_acceptance_rows", supabaseUrl), {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      owner_id: otherUserId,
      note: "cross-user-insert-" + randomUUID(),
    }),
  });
  assert.ok(response.status >= 400, "RLS must reject inserting a row owned by another synthetic user");
}

async function assertForgedJwtRejected(accessToken) {
  const segments = accessToken.split(".");
  assert.equal(segments.length, 3);
  segments[2] = (segments[2][0] === "A" ? "B" : "A") + segments[2].slice(1);
  const response = await fetch(new URL("/rest/v1/auth_oidc_acceptance_rows?select=id", supabaseUrl), {
    headers: {
      apikey: publishableKey,
      Authorization: "Bearer " + segments.join("."),
    },
  });
  assert.ok(response.status >= 400, "Supabase must reject a forged/tampered JWT signature");
}

async function signOut(cookie, accessToken) {
  const response = await fetch(authBase + "/sign-out", {
    method: "POST",
    headers: {
      Origin: appOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.ok(response.status >= 200 && response.status < 300, "Better Auth must revoke the synthetic test session");
  const userInfo = await fetch(authBase + "/oauth2/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  assert.equal(userInfo.status, 401, "session-bound UserInfo must reject the token after session logout");
}

async function cleanupSyntheticUsers() {
  const response = await fetch(authOrigin + "/_internal/oidc-acceptance/cleanup", {
    method: "POST",
    headers: acceptanceHeaders,
    redirect: "error",
  });
  assert.equal(response.status, 200, "synthetic user cleanup must succeed");
  const payload = await parseJson(response, "OIDC acceptance cleanup");
  assert.equal(payload.ok, true);
  assert.equal(payload.removed, 2, "both synthetic users must be removed");
}

let users = [];
try {
  users = await bootstrapSyntheticUsers();
  const { discovery, remoteJwks } = await getDiscoveryAndJwks();
  const tokens = [];

  for (const user of users) {
    const token = await mintAccessToken(user.cookie, { ...discovery, remoteJwks });
    assert.equal(token.userId, user.id, "JWT sub must equal the Better Auth user UUID");
    tokens.push(token);
  }

  for (let index = 0; index < users.length; index += 1) {
    const visible = await readFixtureRows(tokens[index].accessToken);
    assert.deepEqual(
      visible.map((row) => row.owner_id),
      [users[index].id],
      "Supabase RLS must expose only the current Better Auth UUID's row",
    );
  }

  await assertRejectedCrossUserInsert(tokens[0].accessToken, users[1].id);
  await assertForgedJwtRejected(tokens[0].accessToken);

  for (let index = 0; index < users.length; index += 1) {
    await signOut(users[index].cookie, tokens[index].accessToken);
  }

  console.log(JSON.stringify({
    success: true,
    project: "sykabelajar-auth-staging",
    issuer,
    synthetic_users_tested: users.length,
    checks: [
      "OIDC discovery and public ES256 JWKS",
      "Authorization Code + PKCE S256",
      "RFC 9207 authorization-response iss",
      "access-token claims: iss/sub/aud/role/iat/exp",
      "OIDC ID-token audience and nonce",
      "Supabase Data API accepts Better Auth JWT",
      "auth.uid UUID identity and two-user RLS isolation",
      "cross-user insert rejected",
      "forged signature rejected",
      "session-bound UserInfo rejected after logout",
    ],
    production_project_touched: false,
  }));
} finally {
  // Do not leave synthetic Better Auth identities or sessions in staging D1.
  await cleanupSyntheticUsers();
}

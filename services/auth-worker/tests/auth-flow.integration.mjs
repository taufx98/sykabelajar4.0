import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const baseUrl = process.env.AUTH_WORKER_BASE_URL ?? "http://127.0.0.1:8787";
const appOrigin = process.env.DEV_APP_ORIGIN ?? "http://localhost:5173";
const resourceAudience = process.env.SUPABASE_RESOURCE_AUDIENCE ?? "https://sykabelajar.my.id";
const mailToken = process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
const clientBootstrapToken = process.env.OAUTH_CLIENT_BOOTSTRAP_TOKEN;
const callbackUrl = process.env.OAUTH_CALLBACK_URL ?? "https://sykabelajar.my.id/auth/oidc/callback";
const mailMessages = [];

assert.ok(mailToken && mailToken.length >= 32, "test mail webhook token must be configured");
assert.ok(clientBootstrapToken && clientBootstrapToken.length >= 32, "OAuth client bootstrap token must be configured");

const mailServer = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/send") {
    response.writeHead(404).end();
    return;
  }

  if (request.headers.authorization !== "Bearer " + mailToken) {
    response.writeHead(401).end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let message;
  try {
    message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (
    !message ||
    typeof message.to !== "string" ||
    typeof message.text !== "string" ||
    !["verify-email", "reset-password"].includes(message.category)
  ) {
    response.writeHead(422).end();
    return;
  }

  mailMessages.push(message);
  response.writeHead(202, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ accepted: true }));
});

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function sessionCookie(response) {
  return getSetCookies(response)
    .filter((value) => /session_token=/i.test(value) && !/max-age=0/i.test(value))
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function parseJson(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Expected JSON from Worker; received HTTP " + response.status);
  }
}

async function authRequest(path, { method = "GET", body, cookie, headers = {}, redirect = "manual" } = {}) {
  return fetch(new URL("/api/auth" + path, baseUrl), {
    method,
    redirect,
    headers: {
      Origin: appOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function mailUrl(message) {
  const match = message.text.match(/https?:\\/\\/[^\\s]+/);
  assert.ok(match, "captured email must contain an action URL");
  const url = new URL(match[0]);
  // The test Worker may advertise the real Better Auth issuer while still
  // running entirely on localhost. Route captured email actions back to that
  // local process; never send a CI request to the hosted staging Worker.
  const testIssuerOrigin = process.env.STAGE5_D1_ISSUER_ORIGIN;
  if (testIssuerOrigin && url.origin === testIssuerOrigin) {
    const localWorker = new URL(baseUrl);
    url.protocol = localWorker.protocol;
    url.host = localWorker.host;
  }
  return url;
}

function cookieUuid() {
  return "poc-" + randomUUID() + "@example.test";
}

async function exchangeAuthorizationCode({ clientId, code, verifier, redirectUri = callbackUrl }) {
  return fetch(new URL("/api/auth/oauth2/token", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: appOrigin,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
      resource: resourceAudience,
    }),
  });
}

async function createAuthorizationCode({ clientId, cookie, includePkce = true, scope = "openid profile email", redirectUri = callbackUrl }) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  const nonce = randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    resource: resourceAudience,
    state,
    nonce,
  });

  if (includePkce) {
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }

  const response = await fetch(new URL("/api/auth/oauth2/authorize?" + params.toString(), baseUrl), {
    redirect: "manual",
    headers: {
      Origin: appOrigin,
      Cookie: cookie,
      Accept: "text/html,application/json",
    },
  });

  const headerLocation = response.headers.get("location");
  let responsePayload = null;
  let diagnosticBody = "";
  if (!headerLocation) {
    diagnosticBody = (await response.clone().text()).slice(0, 2000);
    try {
      responsePayload = JSON.parse(diagnosticBody);
    } catch {
      responsePayload = null;
    }
  }
  // Better Auth returns a JSON redirect envelope for programmatic/fetch
  // requests. A real top-level browser navigation receives an HTTP redirect.
  const location = headerLocation ??
    (responsePayload?.redirect === true && typeof responsePayload.url === "string"
      ? responsePayload.url
      : null);
  const callback = location ? new URL(location) : null;
  return { response, location, callback, verifier, state, nonce, diagnosticBody };
}

test("email verification, session lifecycle, public OAuth PKCE, and ES256 access-token checks", async (t) => {
  await new Promise((resolve, reject) => {
    mailServer.once("error", reject);
    mailServer.listen(8788, resolve);
  });

  try {
    const allowedPreflight = await fetch(new URL("/api/auth/get-session", baseUrl), {
      method: "OPTIONS",
      headers: {
        Origin: appOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(allowedPreflight.status, 204, "allowlisted browser preflight must succeed");
    assert.equal(
      allowedPreflight.headers.get("access-control-allow-origin"),
      appOrigin,
      "CORS must return the exact allowlisted origin",
    );
    assert.equal(
      allowedPreflight.headers.get("access-control-allow-credentials"),
      "true",
      "credentialed first-party requests must be supported",
    );
    assert.notEqual(
      allowedPreflight.headers.get("access-control-allow-origin"),
      "*",
      "credentialed CORS must never use a wildcard origin",
    );

    const adminSettingsPreflight = await fetch(new URL("/api/admin/email-settings", baseUrl), {
      method: "OPTIONS",
      headers: {
        Origin: appOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(adminSettingsPreflight.status, 204, "allowlisted admin email settings preflight must succeed");
    assert.equal(adminSettingsPreflight.headers.get("access-control-allow-origin"), appOrigin);
    assert.match(adminSettingsPreflight.headers.get("access-control-allow-headers") ?? "", /authorization/i);
    assert.match(adminSettingsPreflight.headers.get("access-control-allow-headers") ?? "", /content-type/i);

    const publicEmailSettings = await fetch(new URL("/api/admin/email-settings", baseUrl), {
      headers: { Origin: appOrigin },
    });
    assert.equal(publicEmailSettings.status, 401, "admin email settings must reject unauthenticated GET requests");
    const publicEmailSettingsBody = await parseJson(publicEmailSettings);
    assert.equal(publicEmailSettingsBody.error, "AUTH_REQUIRED");
    assert.equal(JSON.stringify(publicEmailSettingsBody).includes("send_mail_token"), false, "unauthenticated response must not expose provider credentials");

    const untrustedEmailSettings = await fetch(new URL("/api/admin/email-settings", baseUrl), {
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(untrustedEmailSettings.status, 403, "admin email settings must reject untrusted origins");

    const rejectedPreflight = await fetch(new URL("/api/auth/get-session", baseUrl), {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(rejectedPreflight.status, 403, "untrusted browser preflight must be rejected");
    assert.equal(
      rejectedPreflight.headers.get("access-control-allow-origin"),
      null,
      "untrusted origin must not receive CORS permission",
    );

    const browserBootstrap = await fetch(new URL("/_internal/bootstrap-first-party-client", baseUrl), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + clientBootstrapToken,
        Origin: appOrigin,
      },
    });
    assert.equal(
      browserBootstrap.status,
      404,
      "internal OAuth bootstrap must reject browser-origin requests even with the bearer secret",
    );
    const email = cookieUuid();
    const username = "poc-" + randomUUID().slice(0, 8);
    const accountType = "teacher";
    const referralCode = "AUTH-POC-REFERRAL";
    const initialPassword = "Sykabelajar-PoC-Password-1";
    const resetPassword = "Sykabelajar-PoC-Password-2";

    // The same email is retried with valid data below. A successful retry proves
    // an invalid business role was rejected before Better Auth committed a D1
    // user row; a post-insert rejection would leave this email unusable.
    const invalidSignup = await authRequest("/sign-up/email", {
      method: "POST",
      body: {
        name: "SYKABELAJAR Invalid Auth PoC",
        email,
        password: initialPassword,
        accountType: "admin",
        username: "invalid-admin",
        callbackURL: appOrigin + "/auth/verified",
      },
    });
    assert.equal(invalidSignup.status, 400, "admin must be rejected before D1 user creation");
    assert.equal(
      mailMessages.some((message) => message.category === "verify-email" && message.to === email),
      false,
      "invalid registration must not dispatch a verification email",
    );

    const signup = await authRequest("/sign-up/email", {
      method: "POST",
      body: {
        name: "SYKABELAJAR Auth PoC",
        email,
        password: initialPassword,
        accountType,
        username,
        referralCode,
        birthDate: "2009-02-03",
        institution: "SMA Negeri 1 Bandung",
        grade: "sma",
        subjects: "math,science",
        callbackURL: appOrigin + "/auth/verified",
      },
    });
    assert.ok(signup.ok, "sign-up/email must succeed; HTTP " + signup.status);
    const signupData = await parseJson(signup);
    assert.ok(signupData?.user?.id, "sign-up response must contain a Better Auth user");
    assert.match(
      signupData.user.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "Better Auth user ID must be a UUID",
    );

    // A valid password is not sufficient to create a session before the
    // user's email challenge has been completed. This specifically guards the
    // unverified-login regression observed in hosted staging.
    const unverifiedSignIn = await authRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: initialPassword },
    });
    assert.equal(unverifiedSignIn.ok, false, "unverified user must not sign in");
    assert.equal(
      sessionCookie(unverifiedSignIn),
      "",
      "unverified sign-in response must not issue a session cookie",
    );
    const unauthenticatedSession = await authRequest("/get-session");
    assert.equal(unauthenticatedSession.status, 200, "anonymous session lookup must remain a successful read");
    assert.equal(
      await parseJson(unauthenticatedSession),
      null,
      "unverified signup must leave no authenticated session before email verification",
    );

    const verificationMessage = mailMessages.find((message) => message.category === "verify-email" && message.to === email);
    assert.ok(verificationMessage, "sign-up must deliver a verification email through the configured webhook");
    const verificationUrl = mailUrl(verificationMessage);
    assert.equal(verificationUrl.searchParams.get("callbackURL"), appOrigin + "/auth/verified",
      "verification email must carry the explicit public frontend callback route");
    const verificationResponse = await fetch(verificationUrl, {
      redirect: "manual",
      headers: { Origin: appOrigin },
    });
    assert.ok(
      verificationResponse.status >= 200 && verificationResponse.status < 400,
      "verification link must be accepted; HTTP " + verificationResponse.status,
    );
    const verificationLocation = verificationResponse.headers.get("location");
    assert.ok(verificationLocation, "successful verification must redirect to the frontend callback");
    const verificationCallback = new URL(verificationLocation, verificationUrl);
    assert.equal(verificationCallback.origin, appOrigin, "verification must return only to the app origin");
    assert.equal(verificationCallback.pathname, "/auth/verified", "verification must reach the registered callback page");


    let cookie = sessionCookie(verificationResponse);
    if (!cookie) {
      const signInAfterVerify = await authRequest("/sign-in/email", {
        method: "POST",
        body: { email, password: initialPassword },
      });
      assert.ok(signInAfterVerify.ok, "verified user must be able to sign in");
      cookie = sessionCookie(signInAfterVerify);
    }
    assert.ok(cookie, "verification or sign-in response must set a session cookie");

    const verifiedSessionResponse = await authRequest("/get-session", { cookie });
    assert.ok(verifiedSessionResponse.ok, "authenticated session lookup must return HTTP 200");
    const verifiedSession = await parseJson(verifiedSessionResponse);
    assert.equal(verifiedSession?.user?.email, email, "session must belong to the newly registered account");
    assert.equal(verifiedSession?.user?.emailVerified, true, "email must be marked verified before session is used");
    assert.equal(verifiedSession?.user?.id, signupData.user.id, "session and signup must refer to the same UUID");
    assert.equal(signupData.user.accountType, accountType, "registration accountType must be persisted by D1");
    assert.equal(signupData.user.username, username, "registration username must be persisted by D1");
    assert.equal(signupData.user.referralCode, undefined, "referral code must not be exposed in signup responses");
    for (const field of ["birthDate", "institution", "grade", "subjects"]) {
      assert.equal(signupData.user[field], undefined, "profile bootstrap field " + field + " must not be exposed in signup responses");
    }
    assert.equal(verifiedSession?.user?.accountType, accountType, "session must expose the persisted registration accountType");
    assert.equal(verifiedSession?.user?.username, username, "session must expose the persisted registration username");
    assert.equal(verifiedSession?.user?.referralCode, undefined, "session must not expose the referral input");
    for (const field of ["birthDate", "institution", "grade", "subjects"]) {
      assert.equal(verifiedSession?.user?.[field], undefined, "profile bootstrap field " + field + " must not be exposed in sessions");
    }
    assert.equal(verifiedSession?.user?.role, undefined, "application business roles must not be copied into Better Auth user metadata");

    const resetRequest = await authRequest("/request-password-reset", {
      method: "POST",
      body: {
        email,
        redirectTo: appOrigin + "/reset-password",
      },
    });
    assert.ok(resetRequest.ok, "password-reset request must complete without exposing account lookup state");
    const resetMessage = mailMessages.find((message) => message.category === "reset-password" && message.to === email);
    assert.ok(resetMessage, "password-reset request must deliver a reset email");
    const resetUrl = mailUrl(resetMessage);
    const requestedWorkerUrl = new URL(baseUrl);
    const resetUsesConfiguredWorker = resetUrl.origin === requestedWorkerUrl.origin;
    const resetUsesLocalWorkerAlias =
      resetUrl.port === requestedWorkerUrl.port &&
      ["localhost", "127.0.0.1"].includes(resetUrl.hostname) &&
      ["localhost", "127.0.0.1"].includes(requestedWorkerUrl.hostname);
    assert.ok(resetUsesConfiguredWorker || resetUsesLocalWorkerAlias,
      "reset email must use the configured Worker issuer, allowing only its localhost/127.0.0.1 test alias");
    assert.ok(resetUrl.pathname.includes("/api/auth/reset-password/"), "reset email must use Better Auth's single-use reset route");
    assert.equal(resetUrl.searchParams.get("callbackURL"), appOrigin + "/reset-password",
      "reset email must return to the public frontend reset page");
    const resetToken = resetUrl.pathname.split("/").filter(Boolean).at(-1);
    assert.ok(resetToken && resetToken.length >= 20, "reset email must contain a high-entropy token");

    // Follow the actual email URL (without auto-following) and prove Better Auth
    // redirects to the app page with the single-use token in the query string.
    const resetNavigation = await fetch(resetUrl, { redirect: "manual" });
    assert.ok(
      [302, 303, 307, 308].includes(resetNavigation.status),
      "reset email navigation must redirect to the app page; HTTP " + resetNavigation.status,
    );
    const resetLocation = resetNavigation.headers.get("location");
    assert.ok(resetLocation, "reset email navigation must include a redirect location");
    const appResetUrl = new URL(resetLocation, resetUrl);
    assert.equal(appResetUrl.origin, appOrigin, "reset token must not redirect to another origin");
    assert.equal(appResetUrl.pathname, "/reset-password", "reset token must reach the dedicated recovery route");
    assert.equal(appResetUrl.searchParams.get("token"), resetToken,
      "reset callback must carry the exact single-use token expected by ResetPasswordPage");
    assert.equal(appResetUrl.searchParams.has("error"), false, "valid reset callback must not include an error");

    const reset = await authRequest("/reset-password", {
      method: "POST",
      body: { token: resetToken, newPassword: resetPassword },
    });
    assert.ok(reset.ok, "password reset must consume its token successfully");

    const signIn = await authRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: resetPassword },
    });
    assert.ok(signIn.ok, "user must sign in with the newly reset password");
    cookie = sessionCookie(signIn);
    assert.ok(cookie, "successful sign-in must set the Better Auth session cookie");
    const sessionCookieHeader = getSetCookies(signIn).find((value) => /session_token=/i.test(value)) ?? "";
    assert.match(sessionCookieHeader, /\bHttpOnly\b/i, "session cookie must be HttpOnly");
    assert.match(sessionCookieHeader, /\bSecure\b/i, "session cookie must be Secure");
    assert.match(sessionCookieHeader, /SameSite=Lax/i, "session cookie must use SameSite=Lax");
    assert.doesNotMatch(
      sessionCookieHeader,
      /;\s*Domain=/i,
      "session cookie must remain host-only and must not set a Domain attribute",
    );

    // Change-password requires the current credential and can revoke other
    // sessions without signing out the session that performed the change.
    const secondarySignIn = await authRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: resetPassword },
    });
    assert.ok(secondarySignIn.ok, "a second device session must be created before the password-change test");
    const secondaryCookie = sessionCookie(secondarySignIn);
    assert.ok(secondaryCookie && secondaryCookie !== cookie, "second sign-in must receive a distinct session cookie");

    const rejectedPasswordChange = await authRequest("/change-password", {
      method: "POST",
      body: {
        currentPassword: "Sykabelajar-Wrong-Password",
        newPassword: "Sykabelajar-PoC-Password-3",
        revokeOtherSessions: true,
      },
      cookie,
    });
    assert.equal(rejectedPasswordChange.ok, false, "change-password must reject an incorrect current password");
    const sessionAfterRejectedPasswordChange = await authRequest("/get-session", { cookie });
    assert.ok(await parseJson(sessionAfterRejectedPasswordChange), "a rejected password change must preserve the active session");

    const changedPassword = "Sykabelajar-PoC-Password-3";
    const passwordChange = await authRequest("/change-password", {
      method: "POST",
      body: {
        currentPassword: resetPassword,
        newPassword: changedPassword,
        revokeOtherSessions: true,
      },
      cookie,
    });
    assert.ok(passwordChange.ok, "change-password must accept the correct current password");
    // Better Auth may rotate the current session cookie while changing the
    // credential. Prefer that response cookie when validating the surviving
    // session, while still requiring the second device's old cookie to fail.
    const rotatedSessionCookie = sessionCookie(passwordChange);
    if (rotatedSessionCookie) cookie = rotatedSessionCookie;
    const currentSessionAfterPasswordChange = await authRequest("/get-session", { cookie });
    const currentSessionAfterPasswordChangeData = await parseJson(currentSessionAfterPasswordChange);
    assert.ok(
      currentSessionAfterPasswordChangeData,
      "the session performing the password change must remain active; rotatedCookie=" + Boolean(rotatedSessionCookie),
    );

    const secondarySessionAfterPasswordChange = await authRequest("/get-session", { cookie: secondaryCookie });
    assert.equal(await parseJson(secondarySessionAfterPasswordChange), null, "revokeOtherSessions must invalidate the other device session");

    const oldPasswordSignIn = await authRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: resetPassword },
    });
    assert.equal(oldPasswordSignIn.ok, false, "the previous password must stop authenticating after a successful change");

    const newPasswordSignIn = await authRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: changedPassword },
    });
    assert.ok(newPasswordSignIn.ok, "the new password must authenticate successfully");
    const newPasswordCookie = sessionCookie(newPasswordSignIn);
    assert.ok(newPasswordCookie, "the new password sign-in must create a session");
    const newPasswordSignOut = await authRequest("/sign-out", {
      method: "POST",
      body: {},
      cookie: newPasswordCookie,
    });
    assert.ok(newPasswordSignOut.ok, "the temporary new-password verification session must be revoked");

    const bootstrap = await fetch(new URL("/_internal/bootstrap-first-party-client", baseUrl), {
      method: "POST",
      headers: { Authorization: "Bearer " + clientBootstrapToken },
    });
    const bootstrapData = await parseJson(bootstrap);
    assert.ok(
      bootstrap.status === 200 || bootstrap.status === 201,
      "first-party OAuth client bootstrap must succeed; HTTP " +
        bootstrap.status + " " + JSON.stringify(bootstrapData),
    );
    assert.ok(bootstrapData?.client_id, "first-party client bootstrap must return a client ID");
    assert.equal(bootstrapData.already_configured, true, "the client must be provisioned by the versioned D1 migration");

    const discoveryResponse = await authRequest("/.well-known/openid-configuration");
    assert.equal(discoveryResponse.status, 200, "OIDC discovery must respond 200");
    const discovery = await parseJson(discoveryResponse);
    const issuer = new URL(discovery.issuer);
    const expectedIssuer = process.env.STAGE5_EXPECTED_ISSUER;
    if (expectedIssuer) {
      assert.equal(discovery.issuer, expectedIssuer);
    } else {
      assert.equal(issuer.hostname, "localhost");
      assert.equal(issuer.pathname, "/api/auth");
    }
    assert.ok(discovery.code_challenge_methods_supported?.includes("S256"), "OIDC discovery must advertise S256");
    assert.ok(discovery.jwks_uri, "OIDC discovery must advertise JWKS");

    const publicClient = await createAuthorizationCode({
      clientId: bootstrapData.client_id,
      cookie,
      includePkce: false,
    });
    assert.ok(
      publicClient.location && publicClient.callback,
      "authorization without PKCE must redirect to the exact registered callback",
    );
    assert.equal(
      publicClient.callback.searchParams.get("error"),
      "invalid_request",
      "authorization without PKCE must fail as invalid_request",
    );
    assert.match(
      publicClient.callback.searchParams.get("error_description") ?? "",
      /pkce/i,
      "authorization without PKCE must report the PKCE requirement",
    );

    const offlineAccessAuthorization = await createAuthorizationCode({
      clientId: bootstrapData.client_id,
      cookie,
      includePkce: true,
      scope: "openid profile email offline_access",
    });
    assert.ok(
      offlineAccessAuthorization.callback,
      "offline_access request must return an OAuth redirect response",
    );
    assert.equal(
      offlineAccessAuthorization.callback.searchParams.get("error"),
      "invalid_scope",
      "offline_access must not be enabled for the short-lived Supabase client",
    );

    const invalidVerifierAuthorization = await createAuthorizationCode({
      clientId: bootstrapData.client_id,
      cookie,
      includePkce: true,
    });
    assert.ok(
      invalidVerifierAuthorization.callback?.searchParams.has("code"),
      "valid PKCE setup must issue a code for the negative verifier test",
    );
    const invalidVerifierResponse = await exchangeAuthorizationCode({
      clientId: bootstrapData.client_id,
      code: invalidVerifierAuthorization.callback.searchParams.get("code"),
      verifier: randomBytes(48).toString("base64url"),
    });
    assert.equal(invalidVerifierResponse.status, 400, "wrong PKCE verifier must be rejected");
    const invalidVerifierBody = await parseJson(invalidVerifierResponse);
    assert.equal(invalidVerifierBody?.error, "invalid_grant", "wrong verifier must fail with invalid_grant");

    const authorization = await createAuthorizationCode({
      clientId: bootstrapData.client_id,
      cookie,
      includePkce: true,
    });
    assert.ok(
      authorization.location && authorization.callback,
      "valid S256 authorization request must return a redirect; HTTP " +
        authorization.response.status + "; location=" +
        String(authorization.location) + "; body=" + authorization.diagnosticBody,
    );
    assert.equal(authorization.callback.origin, new URL(callbackUrl).origin);
    assert.equal(authorization.callback.pathname, new URL(callbackUrl).pathname);
    assert.equal(authorization.callback.searchParams.get("state"), authorization.state);
    assert.equal(
      authorization.callback.searchParams.get("iss"),
      discovery.issuer,
      "authorization response must identify its issuer to prevent mix-up attacks (RFC 9207)",
    );
    const code = authorization.callback.searchParams.get("code");
    assert.ok(code, "valid S256 authorization request must return an authorization code");
    assert.ok(!authorization.callback.searchParams.has("error"), "valid PKCE request must not return OAuth error");

    const stagingCallbackUrl = "https://staging.sykabelajar.my.id/auth/oidc/callback";
    const stagingAuthorization = await createAuthorizationCode({
      clientId: bootstrapData.client_id,
      cookie,
      includePkce: true,
      redirectUri: stagingCallbackUrl,
    });
    assert.ok(stagingAuthorization.callback?.searchParams.has("code"),
      "the exact same-site staging callback must be authorized by the first-party client");
    const stagingTokenResponse = await exchangeAuthorizationCode({
      clientId: bootstrapData.client_id,
      code: stagingAuthorization.callback.searchParams.get("code"),
      verifier: stagingAuthorization.verifier,
      redirectUri: stagingCallbackUrl,
    });
    assert.equal(stagingTokenResponse.status, 200,
      "the staging callback must exchange only with its matching redirect URI");

    const tokenResponse = await exchangeAuthorizationCode({
      clientId: bootstrapData.client_id,
      code,
      verifier: authorization.verifier,
    });
    assert.equal(tokenResponse.status, 200, "valid authorization code and verifier must exchange successfully");
    const tokens = await parseJson(tokenResponse);
    assert.ok(tokens?.access_token, "token endpoint must return an access token");
    assert.equal(tokens.token_type?.toLowerCase(), "bearer");
    assert.equal(
      tokens.refresh_token,
      undefined,
      "first-party Supabase client must not receive refresh tokens; it uses short-lived access tokens only",
    );

    const replayResponse = await exchangeAuthorizationCode({
      clientId: bootstrapData.client_id,
      code,
      verifier: authorization.verifier,
    });
    assert.equal(replayResponse.status, 400, "an authorization code must not be redeemable twice");
    const replayBody = await parseJson(replayResponse);
    assert.equal(replayBody?.error, "invalid_grant", "replayed authorization code must fail with invalid_grant");

    const jwksProxy = process.env.STAGE5_LOCAL_WORKER_JWKS_PROXY;
    const jwksUrl = jwksProxy
      ? new URL("/api/auth/jwks", jwksProxy)
      : new URL(discovery.jwks_uri);
    if (jwksUrl.hostname === "localhost") jwksUrl.hostname = "127.0.0.1";
    const remoteJwks = createRemoteJWKSet(jwksUrl);
    const verifiedJwt = await jwtVerify(tokens.access_token, remoteJwks, {
      issuer: discovery.issuer,
      audience: resourceAudience,
    });
    assert.equal(verifiedJwt.protectedHeader.alg, "ES256", "access token must be signed using ES256");
    assert.ok(verifiedJwt.protectedHeader.kid, "access token must contain a key ID");
    assert.equal(verifiedJwt.payload.sub, signupData.user.id, "JWT subject must be the Better Auth UUID");
    assert.match(
      String(verifiedJwt.payload.sub),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "JWT subject must have a UUID shape accepted by the PostgreSQL identity contract",
    );
    assert.equal(verifiedJwt.payload.role, "authenticated", "JWT role must be the PostgreSQL authenticated role");

    assert.ok(tokens.id_token, "openid scope must return an OIDC ID token");
    const verifiedIdToken = await jwtVerify(tokens.id_token, remoteJwks, {
      issuer: discovery.issuer,
      audience: bootstrapData.client_id,
    });
    assert.equal(verifiedIdToken.protectedHeader.alg, "ES256", "ID token must be signed using ES256");
    assert.equal(verifiedIdToken.payload.sub, signupData.user.id, "ID token subject must match the Better Auth UUID");
    assert.equal(verifiedIdToken.payload.nonce, authorization.nonce, "ID token nonce must match the original authorization request");

    assert.ok(
      Number.isInteger(verifiedJwt.payload.exp) &&
      Number.isInteger(verifiedJwt.payload.iat) &&
      verifiedJwt.payload.exp > verifiedJwt.payload.iat &&
      verifiedJwt.payload.exp - verifiedJwt.payload.iat <= 300,
      "access-token lifetime must be at most five minutes",
    );

    await assert.rejects(
      jwtVerify(tokens.access_token, remoteJwks, {
        issuer: discovery.issuer,
        audience: "https://wrong-audience.example",
      }),
      undefined,
      "JWT must be rejected for the wrong audience",
    );
    await assert.rejects(
      jwtVerify(tokens.access_token, remoteJwks, {
        issuer: "https://wrong-issuer.example/api/auth",
        audience: resourceAudience,
      }),
      undefined,
      "JWT must be rejected for the wrong issuer",
    );
    await assert.rejects(
      jwtVerify(tokens.access_token, remoteJwks, {
        issuer: discovery.issuer,
        audience: resourceAudience,
        currentDate: new Date((verifiedJwt.payload.exp + 1) * 1000),
      }),
      undefined,
      "JWT must be rejected after its exp claim",
    );
    const parts = tokens.access_token.split(".");
    const signature = parts[2];
    parts[2] = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    await assert.rejects(
      jwtVerify(parts.join("."), remoteJwks, {
        issuer: discovery.issuer,
        audience: resourceAudience,
      }),
      undefined,
      "JWT with a modified signature must be rejected",
    );

    const userInfo = await fetch(new URL("/api/auth/oauth2/userinfo", baseUrl), {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    assert.equal(userInfo.status, 200, "live userinfo must accept the valid session-bound access token");
    const userInfoData = await parseJson(userInfo);
    assert.equal(userInfoData.sub, signupData.user.id);
    assert.equal(userInfoData.email, email);
    assert.equal(userInfoData.email_verified, true);

    // Exercise the actual migrated Cloudinary handler with the access token
    // just issued by this local D1-backed Better Auth Worker. The child test
    // proxies only the fixed JWKS URL to this local Worker and mocks Cloudinary;
    // it never contacts or mutates the hosted staging Supabase project.
    if (process.env.STAGE5_D1_HANDLER_ACCEPTANCE === "true") {
      const handlerTestPath = fileURLToPath(new URL(
        "../../supabase/functions/cloudinary-profile-upload/better-auth-d1-issued-token.integration.test.ts",
        import.meta.url,
      ));
      const handlerTest = spawnSync("deno", [
        "test",
        "--node-modules-dir=auto",
        "--allow-env",
        "--allow-net",
        handlerTestPath,
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          STAGE5_BETTER_AUTH_ACCESS_TOKEN: tokens.access_token,
          STAGE5_BETTER_AUTH_USER_ID: signupData.user.id,
        },
        maxBuffer: 8 * 1024 * 1024,
      });
      if (handlerTest.error) throw handlerTest.error;
      if (handlerTest.status !== 0) {
        throw new Error(
          "D1-issued Better Auth token was rejected by the migrated Cloudinary handler. " +
          (handlerTest.stdout ?? "") + (handlerTest.stderr ?? ""),
        );
      }
      console.log("Verified a D1-issued Better Auth access token through the actual migrated Cloudinary profile-upload handler with a mocked provider.");
    }

    // One reset request was already made earlier in this test. The custom
    // limit is three requests/hour, so the third additional attempt must be
    // rejected without sending another reset email.
    const additionalResetStatuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const limitedReset = await authRequest("/request-password-reset", {
        method: "POST",
        body: { email, redirectTo: appOrigin + "/reset-password" },
      });
      additionalResetStatuses.push(limitedReset.status);
    }
    assert.ok(
      additionalResetStatuses.includes(429),
      "password-reset requests must be rate-limited on the real Better Auth endpoint; got " +
        additionalResetStatuses.join(", "),
    );

    const signOut = await authRequest("/sign-out", { method: "POST", body: {}, cookie });
    const signOutBody = await signOut.clone().text();
    assert.ok(
      signOut.ok,
      "sign-out must revoke the session; HTTP " + signOut.status +
        "; location=" + String(signOut.headers.get("location")) +
        "; body=" + signOutBody.slice(0, 1500),
    );
    const sessionAfterLogout = await authRequest("/get-session", { cookie });
    assert.equal(await parseJson(sessionAfterLogout), null, "revoked cookie must no longer resolve to a session");

    const userInfoAfterLogout = await fetch(new URL("/api/auth/oauth2/userinfo", baseUrl), {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    assert.equal(userInfoAfterLogout.status, 401, "session-bound UserInfo must reject an access token after session logout");

    t.diagnostic("Local email verification, password reset, session revoke, OAuth public-client PKCE, and ES256 JWT checks passed.");
  } finally {
    await new Promise((resolve) => mailServer.close(resolve));
  }
});

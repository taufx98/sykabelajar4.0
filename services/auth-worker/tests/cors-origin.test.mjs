import assert from "node:assert/strict";
import test from "node:test";
import { createCorsHeaders, isAllowedOrigin } from "../src/security.mjs";
import { getAllowedOriginsForPath, getEmailAdminAllowedOrigins } from "../src/cors-origins.mjs";

const APP = "https://sykabelajar.my.id";
const DEV = "https://staging.sykabelajar.my.id";
const PREVIEW = "https://security-auth-poc-stage-1.sykabelajar4.pages.dev";
const env = {
  APP_ORIGIN: APP,
  DEV_APP_ORIGIN: DEV,
  EMAIL_ADMIN_PREVIEW_ORIGIN: PREVIEW,
};

test("branch Pages preview can call only the email settings endpoint", () => {
  const allowlist = getAllowedOriginsForPath("/api/admin/email-settings", env);
  assert.equal(isAllowedOrigin(PREVIEW, allowlist), true);
  assert.equal(isAllowedOrigin("https://attacker.security-auth-poc-stage-1.sykabelajar4.pages.dev", allowlist), false);
  assert.equal(isAllowedOrigin("https://security-auth-poc-stage-1.sykabelajar4.pages.dev.evil.example", allowlist), false);

  for (const pathname of ["/api/auth/get-session", "/api/admin/login-providers", "/api/admin/auth-runtime-settings"]) {
    assert.equal(
      isAllowedOrigin(PREVIEW, getAllowedOriginsForPath(pathname, env)),
      false,
      pathname + " must not inherit the email Admin preview exception",
    );
  }
});

test("preflight for the email Admin endpoint returns exact credentialed CORS headers", () => {
  const request = new Request("https://auth.sykabelajar.my.id/api/admin/email-settings", {
    method: "OPTIONS",
    headers: {
      Origin: PREVIEW,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  const headers = createCorsHeaders(
    request,
    getAllowedOriginsForPath("/api/admin/email-settings", env),
  );
  assert.equal(headers?.get("Access-Control-Allow-Origin"), PREVIEW);
  assert.equal(headers?.get("Access-Control-Allow-Credentials"), "true");
  assert.match(headers?.get("Access-Control-Allow-Methods") ?? "", /POST/);
  assert.match(headers?.get("Access-Control-Allow-Headers") ?? "", /Authorization/i);
  assert.match(headers?.get("Access-Control-Allow-Headers") ?? "", /Content-Type/i);
});

test("production without the optional preview binding does not trust Pages previews", () => {
  const productionEnv = { APP_ORIGIN: APP };
  const origins = getEmailAdminAllowedOrigins(productionEnv);
  assert.equal(isAllowedOrigin(PREVIEW, origins), false);
  assert.equal(isAllowedOrigin(APP, origins), true);
});

test("email Admin preview exception does not accept wildcard or attacker origins", () => {
  for (const origin of ["*", "null", "https://attacker.example", "https://evil-security-auth-poc-stage-1.sykabelajar4.pages.dev"]) {
    const request = new Request("https://auth.sykabelajar.my.id/api/admin/email-settings", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(
      createCorsHeaders(request, getEmailAdminAllowedOrigins(env)),
      null,
      "must reject " + origin,
    );
  }
});

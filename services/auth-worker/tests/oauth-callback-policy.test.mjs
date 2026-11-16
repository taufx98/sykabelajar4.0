import assert from "node:assert/strict";
import test from "node:test";
import { getApprovedOAuthCallbackUrls } from "../src/oauth-callback-policy.mjs";

test("Production callback allowlist contains only the canonical website callback", () => {
  assert.deepEqual(
    getApprovedOAuthCallbackUrls("https://sykabelajar.my.id"),
    ["https://sykabelajar.my.id/auth/oidc/callback"],
  );
});

test("staging callback is added only through the explicit exact staging callback setting", () => {
  assert.deepEqual(
    getApprovedOAuthCallbackUrls(
      "https://sykabelajar.my.id",
      "https://staging.sykabelajar.my.id/auth/oidc/callback",
    ),
    [
      "https://sykabelajar.my.id/auth/oidc/callback",
      "https://staging.sykabelajar.my.id/auth/oidc/callback",
    ],
  );
});

test("callback policy rejects malformed, non-HTTPS, path-bearing and duplicate URLs", () => {
  for (const [appOrigin, stagingCallback] of [
    ["http://sykabelajar.my.id", undefined],
    ["https://sykabelajar.my.id/path", undefined],
    ["https://user:pass@sykabelajar.my.id", undefined],
    ["https://sykabelajar.my.id", "http://staging.sykabelajar.my.id/auth/oidc/callback"],
    ["https://sykabelajar.my.id", "https://staging.sykabelajar.my.id/other"],
    ["https://sykabelajar.my.id", "https://staging.sykabelajar.my.id/auth/oidc/callback?next=evil"],
    ["https://sykabelajar.my.id", "https://sykabelajar.my.id/auth/oidc/callback"],
  ]) {
    assert.throws(() => getApprovedOAuthCallbackUrls(appOrigin, stagingCallback));
  }
});

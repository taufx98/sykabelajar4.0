import assert from "node:assert/strict";
import test from "node:test";
import { getApprovedOAuthCallbackUrls } from "../src/oauth-callback-policy.mjs";

test("Production callback allowlist contains only the canonical website callback", () => {
  assert.deepEqual(
    getApprovedOAuthCallbackUrls("https://sykabelajar.my.id"),
    ["https://sykabelajar.my.id/auth/oidc/callback"],
  );
});

test("staging callback allowlist includes the production and staging app origins", () => {
  assert.deepEqual(
    getApprovedOAuthCallbackUrls(
      "https://sykabelajar.my.id",
      "https://staging.sykabelajar.my.id",
    ),
    [
      "https://sykabelajar.my.id/auth/oidc/callback",
      "https://staging.sykabelajar.my.id/auth/oidc/callback",
    ],
  );
});

test("callback policy rejects malformed, non-HTTPS, path-bearing or duplicate origins", () => {
  for (const [appOrigin, devOrigin] of [
    ["http://sykabelajar.my.id", undefined],
    ["https://sykabelajar.my.id/path", undefined],
    ["https://user:pass@sykabelajar.my.id", undefined],
    ["https://sykabelajar.my.id", "http://staging.sykabelajar.my.id"],
    ["https://sykabelajar.my.id", "https://sykabelajar.my.id"],
  ]) {
    assert.throws(() => getApprovedOAuthCallbackUrls(appOrigin, devOrigin));
  }
});

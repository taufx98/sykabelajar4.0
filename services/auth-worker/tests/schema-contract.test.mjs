import test from "node:test";
import assert from "node:assert/strict";
import { getMissingBetterAuthTables } from "../src/schema-contract.mjs";

test("accepts Better Auth OAuth Provider D1 tables in snake_case form", () => {
  const names = [
    "user",
    "session",
    "account",
    "verification",
    "jwks",
    "rate_limit",
    "oauth_client",
    "oauth_resource",
    "oauth_client_resource",
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_consent",
    "oauth_client_assertion",
  ];

  assert.deepEqual(getMissingBetterAuthTables(names), []);
});

test("accepts model names when a D1 adapter returns camelCase table names", () => {
  const names = [
    "user",
    "session",
    "account",
    "verification",
    "jwks",
    "rateLimit",
    "oauthClient",
    "oauthResource",
    "oauthClientResource",
    "oauthAccessToken",
    "oauthRefreshToken",
    "oauthConsent",
    "oauthClientAssertion",
  ];

  assert.deepEqual(getMissingBetterAuthTables(names), []);
});

test("rejects an incomplete OAuth Provider schema and reports exact missing models", () => {
  const names = ["user", "session", "account", "verification", "jwks", "rate_limit", "oauth_client"];
  assert.deepEqual(getMissingBetterAuthTables(names), [
    "oauthResource",
    "oauthClientResource",
    "oauthAccessToken",
    "oauthRefreshToken",
    "oauthConsent",
    "oauthClientAssertion",
  ]);
});

test("normalizes separators without accidentally accepting partial names", () => {
  assert.deepEqual(getMissingBetterAuthTables([
    "user",
    "session",
    "account",
    "verification",
    "jwks",
    "rate-limit",
    "oauth-client",
    "oauth-resource",
    "oauth-client-resource",
    "oauth-access-token",
    "oauth-refresh-token",
    "oauth-consent",
    "oauth-client-assertion",
  ]), []);
  assert.ok(getMissingBetterAuthTables(["oauth_application"]).includes("oauthClient"));
});

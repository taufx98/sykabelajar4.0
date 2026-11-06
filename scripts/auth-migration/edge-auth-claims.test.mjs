import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBetterAuthClaims } from "../supabase/functions/_shared/auth-claims.mjs";

const ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const AUDIENCE = "https://sykabelajar.my.id";
const NOW = 1_800_000_000;
const UUID = "4e65dbd7-7e1c-4d8a-8a7f-0c7d4fbf7a11";

function validClaims(overrides = {}) {
  return {
    iss: ISSUER,
    sub: UUID,
    aud: AUDIENCE,
    role: "authenticated",
    iat: NOW - 10,
    exp: NOW + 290,
    ...overrides,
  };
}

test("accepts only a verified Better Auth UUID identity for the exact issuer and audience", () => {
  const result = validateBetterAuthClaims(validClaims(), { issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.userId, UUID);
  assert.equal(result.issuer, ISSUER);
  assert.equal(result.audience, AUDIENCE);
});

test("supports an audience array only when the configured resource audience is included", () => {
  assert.equal(
    validateBetterAuthClaims(validClaims({ aud: ["https://other.example", AUDIENCE] }), {
      issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW,
    }).ok,
    true,
  );
  assert.equal(
    validateBetterAuthClaims(validClaims({ aud: ["https://other.example"] }), {
      issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW,
    }).reason,
    "AUTH_AUDIENCE_MISMATCH",
  );
});

test("rejects wrong/missing issuer and audience configuration", () => {
  assert.equal(
    validateBetterAuthClaims(validClaims(), { issuer: "https://attacker.example", audience: AUDIENCE, nowSeconds: NOW }).reason,
    "AUTH_ISSUER_MISMATCH",
  );
  assert.equal(validateBetterAuthClaims(validClaims(), { issuer: ISSUER, nowSeconds: NOW }).reason,
    "AUTH_EXPECTED_ISSUER_OR_AUDIENCE_MISSING");
  assert.equal(validateBetterAuthClaims(validClaims({ aud: undefined }), {
    issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW,
  }).reason, "AUTH_AUDIENCE_MISMATCH");
});

test("rejects non-UUID and missing Better Auth subjects", () => {
  for (const sub of ["123", "admin", "not-a-uuid", undefined, null]) {
    assert.equal(validateBetterAuthClaims(validClaims({ sub }), {
      issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW,
    }).reason, "AUTH_SUBJECT_NOT_UUID");
  }
});

test("rejects app business roles in the PostgreSQL role claim", () => {
  for (const role of ["admin", "teacher", "organizer_member", "student", "anon", undefined]) {
    assert.equal(validateBetterAuthClaims(validClaims({ role }), {
      issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW,
    }).reason, "AUTH_POSTGRES_ROLE_INVALID");
  }
});

test("rejects malformed, expired, future-issued, and overlong access tokens", () => {
  const options = { issuer: ISSUER, audience: AUDIENCE, nowSeconds: NOW };
  assert.equal(validateBetterAuthClaims(validClaims({ iat: "bad" }), options).reason,
    "AUTH_TOKEN_TIME_CLAIMS_INVALID");
  assert.equal(validateBetterAuthClaims(validClaims({ exp: NOW }), options).reason,
    "AUTH_TOKEN_EXPIRED");
  assert.equal(validateBetterAuthClaims(validClaims({ iat: NOW + 31 }), options).reason,
    "AUTH_TOKEN_ISSUED_IN_FUTURE");
  assert.equal(validateBetterAuthClaims(validClaims({ iat: NOW - 301, exp: NOW + 1 }), options).reason,
    "AUTH_TOKEN_LIFETIME_INVALID");
  assert.equal(validateBetterAuthClaims(validClaims({ iat: NOW + 10, exp: NOW + 5 }), options).reason,
    "AUTH_TOKEN_ISSUED_IN_FUTURE");
});

test("does not accept untrusted/non-object claims", () => {
  assert.equal(validateBetterAuthClaims(null, { issuer: ISSUER, audience: AUDIENCE }).reason,
    "AUTH_VERIFIED_CLAIMS_MISSING");
  assert.equal(validateBetterAuthClaims([], { issuer: ISSUER, audience: AUDIENCE }).reason,
    "AUTH_VERIFIED_CLAIMS_MISSING");
});

const edgeRoot = new URL("../../supabase/functions/", import.meta.url);
const edgeAdapter = readFileSync(new URL("_shared/better-auth-user.ts", edgeRoot), "utf8");
const supabaseConfig = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
const webhookSource = readFileSync(new URL("payment-gateway-webhook/index.ts", edgeRoot), "utf8");

function functionConfig(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = supabaseConfig.match(new RegExp(`\\[functions\\.${escaped}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`, "m"));
  assert.ok(match, `missing explicit Supabase config block for ${name}`);
  return match[1];
}

test("Edge adapter delegates cryptographic JWT verification to pinned @supabase/server", () => {
  assert.match(edgeAdapter, /npm:@supabase\/server@1\.9\.2/);
  assert.match(edgeAdapter, /createSupabaseContext\(request, \{ auth: "user" \}\)/);
  assert.match(edgeAdapter, /context\.jwtClaims/);
  assert.match(edgeAdapter, /context\.userClaims\?\.id/);
  assert.doesNotMatch(edgeAdapter, /jwt-decode|atob\(|crypto\.subtle|jsonwebtoken/i);
  assert.doesNotMatch(edgeAdapter, /auth\.getUser\(/);
});

test("verified user adapter fails closed without exact issuer and resource audience config", () => {
  assert.match(edgeAdapter, /BETTER_AUTH_ISSUER/);
  assert.match(edgeAdapter, /BETTER_AUTH_RESOURCE_AUDIENCE/);
  assert.match(edgeAdapter, /AUTH_IDENTITY_CONFIGURATION_MISSING/);
  assert.match(edgeAdapter, /AUTH_SUBJECT_MISMATCH/);
  assert.match(edgeAdapter, /AUTH_POSTGRES_ROLE_INVALID/);
});

test("user-invoked payment and Cloudinary functions keep platform JWT verification enabled", () => {
  for (const name of [
    "get-cloudinary-signature",
    "payment-gateway-admin",
    "payment-gateway-create",
    "payment-gateway-reconcile",
    "midtrans-create-payment",
  ]) {
    assert.match(functionConfig(name), /verify_jwt\s*=\s*true/);
  }
});

test("provider webhook endpoints remain JWT-exempt but keep provider signature verification", () => {
  for (const name of ["payment-webhook", "payment-gateway-webhook"]) {
    assert.match(functionConfig(name), /verify_jwt\s*=\s*false/);
  }
  assert.match(webhookSource, /constantTimeEqual/);
  assert.match(webhookSource, /sha512/);
  assert.match(webhookSource, /hmacBase64/);
  assert.match(webhookSource, /INVALID_SIGNATURE/);
});

test("Better Auth Postgres role remains separate from application business roles", () => {
  assert.match(edgeAdapter, /userClaims\?\.role !== "authenticated"/);
  assert.match(edgeAdapter, /userId: identity\.userId/);
  assert.match(supabaseConfig, /\[functions\.payment-gateway-reconcile\][\s\S]*?verify_jwt = true/);
});

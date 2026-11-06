import assert from "node:assert/strict";
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

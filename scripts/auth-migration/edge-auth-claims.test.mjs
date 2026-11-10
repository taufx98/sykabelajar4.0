import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBetterAuthClaims } from "../../supabase/functions/_shared/auth-claims.mjs";
import { resolveApplicationIdentityMode, resolveBetterAuthVerifierConfig, STAGING_BETTER_AUTH_SUPABASE_URL } from "../../supabase/functions/_shared/resolve-application-identity-mode.mjs";

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

test("only the exact isolated staging project selects Better Auth by default", () => {
  assert.equal(
    resolveApplicationIdentityMode({ supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL }),
    "better-auth",
  );
  assert.equal(
    resolveApplicationIdentityMode({ supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL + "/" }),
    "better-auth",
  );
  for (const supabaseUrl of [
    "https://mvdczyitbkxkldjughor.supabase.co",
    "https://another-staging-project.supabase.co",
    "",
    undefined,
  ]) {
    assert.equal(resolveApplicationIdentityMode({ supabaseUrl }), "supabase");
  }
});

test("explicit identity mode overrides the staging default and invalid modes fail closed", () => {
  assert.equal(
    resolveApplicationIdentityMode({
      configuredMode: "supabase",
      supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL,
    }),
    "supabase",
  );
  assert.equal(
    resolveApplicationIdentityMode({
      configuredMode: "better-auth",
      supabaseUrl: "https://mvdczyitbkxkldjughor.supabase.co",
    }),
    "better-auth",
  );
  assert.equal(
    resolveApplicationIdentityMode({
      configuredMode: "unsafe-mode",
      supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL,
    }),
    "invalid",
  );
});

test("Better Auth verifier defaults are supplied only for the exact staging project", () => {
  const staged = resolveBetterAuthVerifierConfig({
    supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL,
  });
  assert.equal(staged.issuer, ISSUER);
  assert.equal(staged.audience, AUDIENCE);

  const production = resolveBetterAuthVerifierConfig({
    supabaseUrl: "https://mvdczyitbkxkldjughor.supabase.co",
  });
  assert.equal(production.issuer, "");
  assert.equal(production.audience, "");

  const overridden = resolveBetterAuthVerifierConfig({
    supabaseUrl: STAGING_BETTER_AUTH_SUPABASE_URL,
    issuer: "https://attacker.example/api/auth",
    audience: AUDIENCE,
  });
  assert.equal(overridden.issuer, "https://attacker.example/api/auth");
  assert.equal(overridden.audience, AUDIENCE);
});

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
  assert.equal(validateBetterAuthClaims(validClaims({ iat: NOW + 31, exp: NOW + 35 }), options).reason,
    "AUTH_TOKEN_ISSUED_IN_FUTURE");
  assert.equal(validateBetterAuthClaims(validClaims({ iat: NOW + 10, exp: NOW + 5 }), options).reason,
    "AUTH_TOKEN_LIFETIME_INVALID");
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
const applicationIdentityResolver = readFileSync(new URL("_shared/require-application-user.ts", edgeRoot), "utf8");
const cloudinarySignerSource = readFileSync(new URL("get-cloudinary-signature/index.ts", edgeRoot), "utf8");
const cloudinaryDeleteSource = readFileSync(new URL("cloudinary-delete-asset/index.ts", edgeRoot), "utf8");
const cloudinaryUploadSource = readFileSync(new URL("cloudinary-profile-upload/index.ts", edgeRoot), "utf8");
const cloudinaryProfileDeleteSource = readFileSync(new URL("cloudinary-delete-profile/index.ts", edgeRoot), "utf8");
const cloudinaryUploadV2Source = readFileSync(new URL("cloudinary-profile-upload-v2/index.ts", edgeRoot), "utf8");
const cloudinaryDeleteV2Source = readFileSync(new URL("cloudinary-delete-asset-v2/index.ts", edgeRoot), "utf8");
const paymentAdminSource = readFileSync(new URL("payment-gateway-admin/index.ts", edgeRoot), "utf8");
const paymentCreateSource = readFileSync(new URL("payment-gateway-create/index.ts", edgeRoot), "utf8");
const paymentReconcileSource = readFileSync(new URL("payment-gateway-reconcile/index.ts", edgeRoot), "utf8");
const midtransDelegateSource = readFileSync(new URL("midtrans-create-payment/index.ts", edgeRoot), "utf8");

function functionConfig(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = supabaseConfig.match(new RegExp(`\\[functions\\.${escaped}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`, "m"));
  assert.ok(match, `missing explicit Supabase config block for ${name}`);
  return match[1];
}

test("Edge adapter delegates cryptographic JWT verification to pinned @supabase/server", () => {
  assert.match(edgeAdapter, /npm:@supabase\/server@1\.9\.2/);
  assert.match(edgeAdapter, /createSupabaseContext\(request,[\s\S]*?auth: "user"[\s\S]*?issuer: EXPECTED_BETTER_AUTH_ISSUER[\s\S]*?audience: EXPECTED_RESOURCE_AUDIENCE[\s\S]*?env: \{[\s\S]*?jwks: betterAuthJwks/);
  assert.match(edgeAdapter, /const betterAuthJwks = new URL\("jwks", issuer \+ "\/"\)/);
  assert.match(edgeAdapter, /EXPECTED_BETTER_AUTH_ISSUER = "https:\/\/auth\.sykabelajar\.my\.id\/api\/auth"/);
  assert.match(edgeAdapter, /EXPECTED_RESOURCE_AUDIENCE = "https:\/\/sykabelajar\.my\.id"/);
  assert.match(edgeAdapter, /context\.jwtClaims/);
  assert.match(edgeAdapter, /context\.userClaims\?\.id/);
  assert.doesNotMatch(edgeAdapter, /jwt-decode|atob\(|crypto\.subtle|jsonwebtoken/i);
  assert.doesNotMatch(edgeAdapter, /auth\.getUser\(/);
});

test("verified user adapter uses the staging-pinned configuration resolver and fails closed elsewhere", () => {
  assert.match(edgeAdapter, /BETTER_AUTH_ISSUER/);
  assert.match(edgeAdapter, /BETTER_AUTH_RESOURCE_AUDIENCE/);
  assert.match(edgeAdapter, /resolveBetterAuthVerifierConfig/);
  assert.match(edgeAdapter, /AUTH_IDENTITY_CONFIGURATION_MISSING/);
  assert.match(edgeAdapter, /AUTH_SUBJECT_MISMATCH/);
  assert.match(edgeAdapter, /AUTH_POSTGRES_ROLE_INVALID/);
  assert.match(edgeAdapter, /status >= 500[\s\S]*AUTH_VERIFICATION_UNAVAILABLE/);
  const appResolver = readFileSync(new URL("_shared/require-application-user.ts", edgeRoot), "utf8");
  assert.match(appResolver, /resolveApplicationIdentityMode/);
  assert.match(appResolver, /AUTH_IDENTITY_MODE/);
});

test("migrated handlers bypass gateway JWT verification only because the shared resolver verifies every request", () => {
  for (const name of [
    "get-cloudinary-signature",
    "cloudinary-profile-upload",
    "cloudinary-profile-upload-v2",
    "cloudinary-delete-asset",
    "cloudinary-delete-asset-v2",
    "cloudinary-delete-profile",
    "payment-gateway-admin",
    "payment-gateway-create",
    "payment-gateway-reconcile",
    "midtrans-create-payment",
  ]) {
    assert.match(functionConfig(name), /verify_jwt\s*=\s*false/);
  }

  for (const source of [
    cloudinarySignerSource,
    cloudinaryDeleteSource,
    cloudinaryUploadSource,
    cloudinaryUploadV2Source,
    cloudinaryDeleteV2Source,
    cloudinaryProfileDeleteSource,
    paymentAdminSource,
    paymentCreateSource,
    paymentReconcileSource,
  ]) {
    assert.match(source, /requireApplicationUser\(/);
  }

  assert.match(midtransDelegateSource, /Authorization/);
  assert.match(midtransDelegateSource, /payment-gateway-create/);
  assert.match(paymentCreateSource, /requireApplicationUser\(/);
  assert.doesNotMatch(applicationIdentityResolver, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test("Cloudinary v2 compatibility aliases use the shared in-handler identity verifier", () => {
  for (const name of ["cloudinary-profile-upload-v2", "cloudinary-delete-asset-v2"]) {
    assert.match(functionConfig(name), /verify_jwt\s*=\s*false/);
  }
  assert.match(cloudinaryUploadV2Source, /requireApplicationUser\(/);
  assert.match(cloudinaryDeleteV2Source, /requireApplicationUser\(/);
  assert.match(cloudinaryDeleteV2Source, /isOwnedCloudinaryPublicId/);
  assert.match(cloudinaryDeleteV2Source, /INVALID_RESOURCE_TYPE/);
  assert.match(cloudinaryDeleteV2Source, /INVALID_DELIVERY_TYPE/);
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
  assert.match(supabaseConfig, /\[functions\.payment-gateway-reconcile\][\s\S]*?verify_jwt = false/);
});

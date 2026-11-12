import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const probePath = new URL(
  "../supabase-test/supabase/functions/better-auth-oidc-acceptance/index.ts",
  import.meta.url,
);
const probe = readFileSync(probePath, "utf8");
const sharedVerifier = readFileSync(
  new URL("../../../supabase/functions/_shared/better-auth-user.ts", import.meta.url),
  "utf8",
);
const sharedClaims = readFileSync(
  new URL("../../../supabase/functions/_shared/auth-claims.mjs", import.meta.url),
  "utf8",
);

test("staging OIDC Edge probe calls the same shared application identity adapter as migrated handlers", () => {
  assert.ok(probe.includes('import { requireApplicationUser } from "./_shared/require-application-user.ts";'));
  assert.ok(probe.includes("identity = await requireApplicationUser(request);"));
  assert.ok(probe.includes('if (identity.mode !== "better-auth")'));
  assert.ok(!probe.includes("createSupabaseContext"));
  assert.ok(!probe.includes("jwt-decode"));
  assert.ok(!probe.includes("atob("));
  assert.ok(sharedVerifier.includes('import { createSupabaseContext } from "npm:@supabase/server@1.9.2";'));
  assert.ok(sharedVerifier.includes('auth: "user"'));
  assert.ok(sharedVerifier.includes("issuer: EXPECTED_BETTER_AUTH_ISSUER"));
  assert.ok(sharedVerifier.includes("audience: EXPECTED_RESOURCE_AUDIENCE"));
  assert.ok(sharedVerifier.includes("jwks: betterAuthJwks"));
  assert.ok(sharedVerifier.includes("context.userClaims?.id !== identity.userId"));
  assert.ok(sharedVerifier.includes('context.userClaims?.role !== "authenticated"'));
});

test("shared Better Auth claims validator enforces issuer, UUID subject, resource audience and five-minute token", () => {
  assert.ok(sharedClaims.includes("claims.iss !== issuer"));
  assert.ok(sharedClaims.includes("UUID_PATTERN.test(claims.sub)"));
  assert.ok(sharedClaims.includes('claims.role !== "authenticated"'));
  assert.ok(sharedClaims.includes("audiences.includes(audience)"));
  assert.ok(sharedClaims.includes("const MAX_ACCESS_TOKEN_SECONDS = 300;"));
  assert.ok(sharedClaims.includes("claims.exp <= nowSeconds"));
});

test("staging OIDC Edge probe reads only the synthetic RLS fixture through the caller-scoped client", () => {
  assert.ok(probe.includes('identity.supabase\n    .from("auth_oidc_acceptance_rows")'));
  assert.ok(probe.includes('.select("id, owner_id, note")'));
  assert.ok(!probe.includes("owner_id, marker"));
  assert.ok(!probe.includes("supabaseAdmin"));
  assert.ok(!probe.includes(".insert("));
  assert.ok(!probe.includes(".update("));
  assert.ok(!probe.includes(".upsert("));
  assert.ok(!probe.includes(".delete("));
  assert.ok(probe.includes("if (crossUserRows.length > 0)"));
  assert.ok(probe.includes('"Cache-Control", "no-store"'));
  assert.ok(probe.includes("production_touched: false"));
});

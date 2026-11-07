import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const probePath = new URL(
  "../supabase-test/supabase/functions/better-auth-oidc-acceptance/index.ts",
  import.meta.url,
);
const probe = readFileSync(probePath, "utf8");

test("staging OIDC Edge probe delegates signature verification to pinned Supabase server SDK", () => {
  assert.match(probe, /npm:@supabase\/server@1\.9\.2/);
  assert.match(probe, /createSupabaseContext\(request, \{ auth: "user" \}\)/);
  assert.match(probe, /context\.jwtClaims/);
  assert.match(probe, /context\.userClaims\?\.id/);
  assert.match(probe, /context\.userClaims\?\.role/);
  assert.doesNotMatch(probe, /jwt-decode|atob\(|crypto\.subtle|jsonwebtoken/i);
});

test("staging OIDC Edge probe enforces exact issuer, UUID subject, resource audience and five-minute token", () => {
  assert.match(probe, /https:\/\/auth\.sykabelajar\.my\.id\/api\/auth/);
  assert.match(probe, /https:\/\/sykabelajar\.my\.id/);
  assert.match(probe, /UUID_PATTERN\.test\(userId\)/);
  assert.match(probe, /claims\?\.role !== "authenticated"/);
  assert.match(probe, /audiences\.includes\(EXPECTED_AUDIENCE\)/);
  assert.match(probe, /Number\(claims\?\.exp\) - Number\(claims\?\.iat\) > 300/);
});

test("staging OIDC Edge probe queries only the synthetic RLS fixture through the caller-scoped client", () => {
  assert.match(probe, /context\.supabase\s*\.from\("auth_oidc_acceptance_rows"\)/);
  assert.doesNotMatch(probe, /context\.supabaseAdmin/);
  assert.doesNotMatch(probe, /\.(insert|update|upsert|delete)\s*\(/);
  assert.match(probe, /crossUserRows\.length > 0/);
  assert.match(probe, /Cache-Control.*no-store/);
});

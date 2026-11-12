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
  assert.match(probe, /import \\{ requireApplicationUser \\} from "\.\\/_shared\\/require-application-user\\.ts"/);
  assert.match(probe, /requireApplicationUser\\(request\\)/);
  assert.match(probe, /identity\\.mode !== "better-auth"/);
  assert.doesNotMatch(probe, /createSupabaseContext|jwt-decode|atob\\(/);
  assert.match(sharedVerifier, /npm:@supabase\\/server@1\\.9\\.2/);
  assert.match(sharedVerifier, /createSupabaseContext\\(request,[\\s\\S]*?auth: "user"/);
  assert.match(sharedVerifier, /issuer: EXPECTED_BETTER_AUTH_ISSUER/);
  assert.match(sharedVerifier, /audience: EXPECTED_RESOURCE_AUDIENCE/);
  assert.match(sharedVerifier, /env:\\s*\\{[\\s\\S]*?jwks: betterAuthJwks/);
  assert.match(sharedVerifier, /context\\.userClaims\\?\\.id !== identity\\.userId/);
  assert.match(sharedVerifier, /context\\.userClaims\\?\\.role !== "authenticated"/);
});

test("shared Better Auth claims validator enforces issuer, UUID subject, resource audience and five-minute token", () => {
  assert.match(sharedClaims, /claims\\.iss !== issuer/);
  assert.match(sharedClaims, /UUID_PATTERN\\.test\\(claims\\.sub\\)/);
  assert.match(sharedClaims, /claims\\.role !== "authenticated"/);
  assert.match(sharedClaims, /audiences\\.includes\\(audience\\)/);
  assert.match(sharedClaims, /MAX_ACCESS_TOKEN_SECONDS = 300/);
  assert.match(sharedClaims, /claims\\.exp <= nowSeconds/);
});

test("staging OIDC Edge probe reads only the synthetic RLS fixture through the caller-scoped client", () => {
  assert.match(probe, /identity\\.supabase\\s*\\.from\\("auth_oidc_acceptance_rows"\\)/);
  assert.match(probe, /\\.select\\("id, owner_id, note"\\)/);
  assert.doesNotMatch(probe, /owner_id, marker/);
  assert.doesNotMatch(probe, /supabaseAdmin/);
  assert.doesNotMatch(probe, /\\.(insert|update|upsert|delete)\\s*\\(/);
  assert.match(probe, /crossUserRows\\.length > 0/);
  assert.match(probe, /Cache-Control.*no-store/);
  assert.match(probe, /production_touched: false/);
});

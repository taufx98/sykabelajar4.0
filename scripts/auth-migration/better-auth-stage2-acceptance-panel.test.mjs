import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const panel = readFileSync(new URL("src/components/admin/BetterAuthAcceptancePanel.tsx", root), "utf8");
const fixture = readFileSync(
  new URL("services/auth-worker/supabase-test/supabase/migrations/20261112083847_better_auth_stage2_storage_realtime_acceptance.sql", root),
  "utf8",
);
const edgeRoot = "services/auth-worker/supabase-test/supabase/functions/better-auth-oidc-acceptance/";
const edge = readFileSync(new URL(edgeRoot + "index.ts", root), "utf8");
const sharedApplicationResolver = readFileSync(
  new URL("supabase/functions/_shared/require-application-user.ts", root),
  "utf8",
);
const sharedBetterAuthVerifier = readFileSync(
  new URL("supabase/functions/_shared/better-auth-user.ts", root),
  "utf8",
);
const sharedIdentityMode = readFileSync(
  new URL("supabase/functions/_shared/resolve-application-identity-mode.mjs", root),
  "utf8",
);
const sharedClaimsValidator = readFileSync(
  new URL("supabase/functions/_shared/auth-claims.mjs", root),
  "utf8",
);

test("owner-run token acceptance UI is hard-limited to the exact staging hostname", () => {
  assert.match(panel, /window\.location\.hostname\s*!==\s*'staging\.sykabelajar\.my\.id'/);
  assert.match(panel, /!isBetterAuthEnabled\(\)/);
  assert.match(panel, /getStagingBetterAuthClient\(\)\.getSession\(\)/);
  assert.doesNotMatch(panel, /window\.location\.hostname\s*!==\s*'sykabelajar\.my\.id'/);
});

test("staging acceptance reissues a real resource token through PKCE for the same active session", () => {
  assert.match(panel, /await runCheck\('resource'/);
  assert.match(panel, /const firstToken = await authClient\.getSupabaseAccessToken\(\)/);
  assert.match(panel, /authClient\.invalidateResourceTokenCache\(\)/);
  assert.match(panel, /const renewedToken = await authClient\.getSupabaseAccessToken\(\)/);
  assert.match(panel, /renewedToken === firstToken/);
  assert.match(panel, /BETTER_AUTH_RESOURCE_TOKEN_REISSUE_NOT_CONFIRMED/);
  assert.match(panel, /BETTER_AUTH_SESSION_CHANGED_DURING_RESOURCE_REISSUE/);
  assert.match(panel, /passed\}\/5 pengujian lulus/);
  assert.doesNotMatch(panel, /console\.(log|warn|error)\([^)]*(firstToken|renewedToken)/i);
});

test("acceptance panel checks Data API identity and denies visible foreign fixture rows", () => {
  assert.match(panel, /from\('profiles'\)[\s\S]*?eq\('id', userId\)/);
  assert.match(panel, /from\('user_roles'\)[\s\S]*?eq\('user_id', userId\)/);
  assert.match(panel, /from\('auth_oidc_acceptance_rows'\)/);
  assert.match(panel, /OIDC_RLS_EXPOSED_SYNTHETIC_FOREIGN_ROWS/);
});

test("Storage acceptance uses the private staging fixture, owns its test path, and cleans probe objects", () => {
  assert.match(fixture, /VALUES\s*\(\s*'auth-oidc-acceptance'[\s\S]*?false/s);
  assert.match(fixture, /bucket_id\s*=\s*'auth-oidc-acceptance'/);
  assert.match(fixture, /storage\.foldername\(name\)\)\[1\]\s*=\s*\(SELECT auth\.uid\(\)::text\)/);
  assert.match(panel, /const BUCKET = 'auth-oidc-acceptance'/);
  assert.match(panel, /const ownedPath = userId \+ '\/' \+ crypto\.randomUUID\(\)/);
  assert.match(panel, /const foreignPath = crypto\.randomUUID\(\) \+ '\/'/);
  assert.match(panel, /storage\.download\(ownedPath\)/);
  assert.match(panel, /storage\.remove\(cleanupPaths\)/);
  assert.match(panel, /STORAGE_CROSS_USER_UPLOAD_WAS_ALLOWED/);
});

test("Realtime acceptance uses an authenticated private topic and verifies foreign-topic denial", () => {
  assert.match(fixture, /realtime\.topic\(\)\s*=\s*'auth-oidc-acceptance:' \|\| \(SELECT auth\.uid\(\)::text\)/);
  assert.match(panel, /getSupabaseAccessToken\(\)/);
  assert.match(panel, /supabase\.realtime\.setAuth\(resourceToken\)/);
  assert.match(panel, /config:\s*\{\s*private:\s*true/);
  assert.match(panel, /REALTIME_FOREIGN_TOPIC_WAS_ALLOWED/);
  assert.match(panel, /supabase\.removeChannel\(channel\)/);
  assert.match(panel, /supabase\.removeChannel\(foreignChannel\)/);
});

test("staging Edge probe uses the exact shared verifier path used by migrated business handlers", () => {
  assert.ok(edge.includes('import { requireApplicationUser } from "./_shared/require-application-user.ts";'));
  assert.ok(edge.includes("identity = await requireApplicationUser(request);"));
  assert.ok(edge.includes('if (identity.mode !== "better-auth")'));
  assert.ok(!edge.includes("createSupabaseContext"));
  assert.ok(!edge.includes("jwt-decode"));
  assert.ok(!edge.includes("atob("));
  assert.ok(edge.includes("if (crossUserRows.length > 0)"));
  assert.ok(edge.includes("read_only: true"));
  assert.ok(edge.includes("production_touched: false"));
  assert.ok(edge.includes("identity_mode: identity.mode"));
  assert.ok(panel.includes("data.identity_mode !== 'better-auth'"));
  assert.ok(panel.includes("data.postgres_role !== 'authenticated'"));
  assert.ok(panel.includes("data.issuer !== 'https://auth.sykabelajar.my.id/api/auth'"));
  assert.ok(panel.includes("data.audience !== 'https://sykabelajar.my.id'"));
  assert.ok(panel.includes("data.production_touched !== false"));
  assert.ok(panel.includes("data.read_only !== true"));
});

test("staging deployment bundles byte-identical shared auth verifier modules", () => {
  const bundled = [
    ["_shared/require-application-user.ts", sharedApplicationResolver],
    ["_shared/better-auth-user.ts", sharedBetterAuthVerifier],
    ["_shared/resolve-application-identity-mode.mjs", sharedIdentityMode],
    ["_shared/auth-claims.mjs", sharedClaimsValidator],
  ];
  for (const [path, expected] of bundled) {
    const actual = readFileSync(new URL(edgeRoot + path, root), "utf8");
    assert.equal(actual, expected, path + " must match the actual migrated-handler helper");
  }
});

test("staging Edge acceptance probe handles browser CORS preflight without widening its origin", () => {
  assert.ok(edge.includes('const STAGING_APP_ORIGIN = "https://staging.sykabelajar.my.id"'));
  assert.match(edge, /if \(origin && origin !== STAGING_APP_ORIGIN\)/);
  assert.match(edge, /if \(request\.method === "OPTIONS"\)/);
  assert.match(edge, /status: 204, headers: responseHeaders/);
  assert.match(edge, /Access-Control-Allow-Origin/);
  assert.match(edge, /Access-Control-Allow-Methods/);
  assert.match(edge, /Access-Control-Allow-Headers/);
  assert.match(edge, /CORS_REQUEST_HEADER_NOT_ALLOWED/);
  assert.match(edge, /"authorization"/);
  assert.match(edge, /"x-client-info"/);
  assert.match(edge, /"apikey"/);
  assert.match(edge, /"content-type"/);
});

test("acceptance UI never prints or copies a bearer token and states staging-only behavior", () => {
  assert.match(panel, /Tidak menampilkan atau menyalin token/);
  assert.match(panel, /Jangan jalankan di Production/);
  assert.doesNotMatch(panel, /console\.(log|warn|error)\([^)]*(token|authorization)/i);
  assert.doesNotMatch(panel, /GenUI\.copy|navigator\.clipboard/);
});

console.log("Better Auth Stage 2 acceptance panel contracts passed.");

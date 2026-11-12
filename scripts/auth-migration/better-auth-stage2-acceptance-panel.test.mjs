import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const panel = readFileSync(new URL("src/components/admin/BetterAuthAcceptancePanel.tsx", root), "utf8");
const fixture = readFileSync(
  new URL("services/auth-worker/supabase-test/supabase/migrations/20261112083847_better_auth_stage2_storage_realtime_acceptance.sql", root),
  "utf8",
);
const edge = readFileSync(
  new URL("services/auth-worker/supabase-test/supabase/functions/better-auth-oidc-acceptance/index.ts", root),
  "utf8",
);

test("owner-run token acceptance UI is hard-limited to the exact staging hostname", () => {
  assert.match(panel, /window\.location\.hostname\s*!==\s*'staging\.sykabelajar\.my\.id'/);
  assert.match(panel, /!isBetterAuthEnabled\(\)/);
  assert.match(panel, /getStagingBetterAuthClient\(\)\.getSession\(\)/);
  assert.doesNotMatch(panel, /window\.location\.hostname\s*!==\s*'sykabelajar\.my\.id'/);
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

test("Edge acceptance handler pins issuer, audience and caller claims and runs read-only under RLS", () => {
  assert.match(edge, /createSupabaseContext\(request,[\s\S]*?auth:\s*"user"/);
  assert.match(edge, /issuer:\s*EXPECTED_ISSUER/);
  assert.match(edge, /audience:\s*EXPECTED_AUDIENCE/);
  assert.match(edge, /crossUserRows\.length\s*>\s*0/);
  assert.match(edge, /read_only:\s*true/);
  assert.match(edge, /production_touched:\s*false/);
  assert.match(panel, /data\.issuer !== 'https:\/\/auth\.sykabelajar\.my\.id\/api\/auth'/);
  assert.match(panel, /data\.audience !== 'https:\/\/sykabelajar\.my\.id'/);
  assert.match(panel, /data\.production_touched !== false/);
  assert.match(panel, /data\.read_only !== true/);
});

test("staging Edge acceptance probe handles browser CORS preflight without widening its origin", () => {
  assert.match(edge, /const STAGING_APP_ORIGIN = "https:\\/\\/staging\\.sykabelajar\\.my\\.id"/);
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

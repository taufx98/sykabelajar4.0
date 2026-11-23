import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const migration = read(
  "supabase/migrations/20261123030000_stage7_revoke_legacy_certificate_verification_rpc.sql",
);
const regression = read(
  "scripts/auth-migration/stage7-public-certificate-verification-rpc-regression.sql",
);
const projectionMigration = read(
  "supabase/migrations/20260902024000_phase12_security_projection_and_fk_indexes.sql",
);
const certificateService = read("src/services/certificate.service.ts");

assert.match(migration, /public\.get_certificate_verification\(text\)/);
assert.match(migration, /84c0d4d474efa4077b1cdebd7f8503fb/,
  "preflight must pin the reviewed Production prosrc fingerprint");
assert.match(migration, /search_path=public, private/,
  "preflight must pin the reviewed function search_path");
assert.match(
  migration,
  /REVOKE EXECUTE ON FUNCTION public\.get_certificate_verification\(text\)\s+FROM PUBLIC, anon, authenticated/i,
  "remove the inherited PUBLIC grant as well as direct browser grants",
);
assert.match(migration, /has_function_privilege\('service_role',[\s\S]*?'EXECUTE'\)/);
assert.doesNotMatch(migration, /FROM PUBLIC, anon, authenticated, service_role/i,
  "service_role execution must be preserved");

assert.match(certificateService, /from\('certificate_verifications_public'\)/,
  "the application must keep using the approved public projection");
assert.doesNotMatch(certificateService, /get_certificate_verification/,
  "the frontend must not call the retired SECURITY DEFINER RPC");

const sourceCallers = spawnSync(
  "git",
  ["grep", "-n", "get_certificate_verification", "--", "src", "supabase/functions"],
  { cwd: root, encoding: "utf8" },
);
assert.equal(sourceCallers.status, 1,
  "no in-repository frontend/Edge Function callers should remain: " + sourceCallers.stdout + sourceCallers.stderr);

assert.match(projectionMigration, /create or replace view public\.certificate_verifications_public with \(security_invoker = true\)/i);
assert.match(projectionMigration, /certificate_verifications_public_select[\s\S]*?PUBLISHED[\s\S]*?REVOKED/i);
assert.match(projectionMigration, /grant select \(certificate_id, verification_code, status, public_name, competition_title, achievement_title, issued_at, revoked_at\)/i);

for (const marker of [
  "STAGE7_CERTIFICATE_VERIFICATION_BROWSER_EXECUTE_REMAINS",
  "STAGE7_CERTIFICATE_VERIFICATION_PUBLIC_EXECUTE_REMAINS",
  "STAGE7_CERTIFICATE_VERIFICATION_SERVICE_ROLE_EXECUTE_MISSING",
  "STAGE7_CERTIFICATE_PUBLIC_VIEW_COLUMNS_DRIFT",
  "STAGE7_CERTIFICATE_PUBLIC_VIEW_NOT_SECURITY_INVOKER",
  "STAGE7_CERTIFICATE_PUBLIC_STATUS_POLICY_DRIFT",
  "STAGE7_CERTIFICATE_LEGACY_RPC_EXECUTED_AS_ANON",
  "STAGE7_CERTIFICATE_LEGACY_RPC_EXECUTED_AS_AUTHENTICATED",
]) {
  assert.ok(regression.includes(marker), "missing disposable regression assertion: " + marker);
}

console.log("Stage 7 public certificate verification RPC retirement contract passed.");

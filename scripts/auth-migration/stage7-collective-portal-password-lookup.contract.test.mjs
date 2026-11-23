import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const migration = read("supabase/migrations/20261123020000_stage7_harden_collective_portal_password_lookup.sql");
const regression = read("scripts/auth-migration/stage7-collective-portal-password-lookup-regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");

const helper = migration.match(
  /CREATE FUNCTION private\.collective_portal_password_lookup_key\(p_password text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(helper, "missing canonical portal password lookup helper");
assert.match(helper, /RETURNS text/i);
assert.match(helper, /LANGUAGE sql/i);
assert.match(helper, /IMMUTABLE/i);
assert.match(helper, /STRICT/i);
assert.match(helper, /SET search_path TO ''/i);
assert.match(helper, /pg_catalog\.encode\(extensions\.digest\(pg_catalog\.left\(p_password,18\),'sha256'\),'hex'\)/i);

assert.match(
  migration,
  /REVOKE ALL ON FUNCTION private\.collective_portal_password_lookup_key\(text\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_REBUILD_REQUIRES_ZERO_CREDENTIAL_ROWS/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_UNIQUE_CONSTRAINT_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_PRIVATE_SCHEMA_USAGE_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_SOURCE_DEFINITION_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_SOURCE_ACL_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_POST_ACL_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_HELPER_ACL_POSTCONDITION_FAILED/);
assert.match(migration, /pg_catalog\.md5\(p\.prosrc\)/);
assert.match(migration, /STAGE7_PORTAL_LOOKUP_STAGE3_BETTER_AUTH_ISSUER_GUARD_MISSING/);

const expectedSourceFingerprints = [
  "e4a007bcd32d3d135ccb48df8636bbd0",
  "1ae119812cdf0497239c9564c5ca9c87",
  "0f9a8c6b114e362e8d228ea40ce2fad4",
  "f5d01e7ab270b1ff332467f2cf80a2f8",
];
for (const fingerprint of expectedSourceFingerprints) {
  assert.ok(migration.includes(fingerprint), "missing reviewed Production source fingerprint: " + fingerprint);
}

const functions = [
  {
    signature: "private.sync_collective_portal_credential",
    source: migration.match(/CREATE OR REPLACE FUNCTION private\.sync_collective_portal_credential\([\s\S]*?\$function\$;/i)?.[0] ?? "",
    lookup: /private\.collective_portal_password_lookup_key\(p_plaintext_password\)/,
  },
  {
    signature: "public.provision_collective_registration",
    source: migration.match(/CREATE OR REPLACE FUNCTION public\.provision_collective_registration\([\s\S]*?\$function\$;/i)?.[0] ?? "",
    lookup: /private\.collective_portal_password_lookup_key\(v_password\)/,
  },
  {
    signature: "public.regenerate_collective_participant_password",
    source: migration.match(/CREATE OR REPLACE FUNCTION public\.regenerate_collective_participant_password\([\s\S]*?\$function\$;/i)?.[0] ?? "",
    lookup: /private\.collective_portal_password_lookup_key\(raw\)/,
  },
  {
    signature: "public.verify_collective_portal_password",
    source: migration.match(/CREATE OR REPLACE FUNCTION public\.verify_collective_portal_password\([\s\S]*?\$function\$;/i)?.[0] ?? "",
    lookup: /private\.collective_portal_password_lookup_key\(coalesce\(p_password,''\)\)/,
  },
];

for (const fn of functions) {
  assert.ok(fn.source, "missing function replacement: " + fn.signature);
  assert.match(fn.source, fn.lookup, "function must use the single full-password lookup helper: " + fn.signature);
  assert.doesNotMatch(fn.source, /digest\s*\(\s*left\s*\(/i, "prefix-based lookup remains in " + fn.signature);
  assert.doesNotMatch(fn.source, /left\s*\([^)]*,\s*8\s*\)/i, "eight-character lookup truncation remains in " + fn.signature);
  assert.match(fn.source, /SECURITY DEFINER/i);
  assert.match(fn.source, /SET search_path TO 'public', 'private', 'extensions'/i);
}

// Keep full bcrypt verification and all existing caller/session behavior intact.
assert.match(functions[3].source, /crypt\(coalesce\(p_password,''\),c\.password_hash\)\s+IS DISTINCT FROM c\.password_hash/i);
assert.match(functions[3].source, /failed_attempts=failed_attempts\+1/i);
assert.match(functions[3].source, /now\(\)\+interval '15 minutes'/i);
assert.match(functions[3].source, /locked_until is not null and c\.locked_until>now\(\)/i);

assert.match(functions[0].source, /crypt\(p_plaintext_password,gen_salt\('bf',12\)\)/i);
assert.match(functions[1].source, /crypt\(v_password,gen_salt\('bf',12\)\)/i);
assert.match(functions[2].source, /crypt\(raw,gen_salt\('bf',12\)\)/i);
assert.match(functions[2].source, /previous_credential_invalidated/);
assert.match(functions[1].source, /AUTH_REQUIRED/);
assert.match(functions[2].source, /AUTH_REQUIRED/);
assert.match(functions[1].source, /private\.current_user_is_better_auth\(\)/);
assert.match(functions[1].source, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(functions[2].source, /private\.current_user_is_better_auth\(\)/);
assert.match(functions[2].source, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(functions[1].source, /substr\(encode\(gen_random_bytes\(16\),'hex'\),1,22\)/);
assert.match(functions[2].source, /substr\(encode\(gen_random_bytes\(16\),'hex'\),1,22\)/);

for (const [signature, acl] of [
  ["private.sync_collective_portal_credential(uuid,text,integer)", "PUBLIC=X/postgres"],
  ["public.provision_collective_registration(uuid)", "authenticated=X/postgres"],
  ["public.regenerate_collective_participant_password(uuid)", "authenticated=X/postgres"],
  ["public.verify_collective_portal_password(text)", "anon=X/postgres"],
]) {
  assert.ok(migration.includes("'" + signature + "'"), "missing ACL preflight signature: " + signature);
  assert.ok(migration.includes(acl), "missing canonical ACL preflight role: " + acl);
}

assert.match(regression, /BEGIN;/);
assert.match(regression, /ROLLBACK;/);
assert.match(regression, /generate_series\(1,5000\)/);
assert.match(regression, /SKABCDEF0000012222333344/);
assert.match(regression, /SKABCDEF0000022222333345/);
assert.match(regression, /SKABCDEF0000012222999999/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_5000_PASSWORD_SCALE_PROBE_FAILED/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_TWO_IDENTITIES_NOT_CREATED/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_SAME_PREFIX_VALID_PASSWORDS_FAILED/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_WRONG_SUFFIX_NOT_COUNTED/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_FIVE_FAILURE_LOCKOUT_NOT_SET/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_LOCKOUT_NOT_ENFORCED/);
assert.match(regression, /STAGE7_PORTAL_LOOKUP_ONE_ACCOUNT_LOCKOUT_AFFECTED_OTHER/);
assert.match(regression, /FOR attempt_no IN 1..5 LOOP/);
assert.match(regression, /RESET ROLE;\s*DO \$stage7_portal_lookup_lockout_state\$/);
assert.match(regression, /SET LOCAL ROLE anon/);

const parentContract = workflow.indexOf("- name: Test Stage 7 collective portal parent-session boundary contract");
const parentHardening = workflow.indexOf("- name: Apply Stage 7 portal parent-session hardening to disposable restore only");
const lookupContract = workflow.indexOf("- name: Test Stage 7 64-bit portal password selector contract");
const lookupMigration = workflow.indexOf("- name: Apply Stage 7 64-bit portal password selector hardening to disposable restore only");
const lookupRuntime = workflow.indexOf("- name: Verify 64-bit portal selector collisions and 5,000 synthetic keys on disposable restore");
const rls = workflow.indexOf("- name: Verify all 23 RLS table boundaries after Stage 5 on disposable restore");
assert.ok(parentContract >= 0 && lookupContract > parentContract, "lookup contract must follow the parent-session source contract");
assert.ok(lookupMigration > lookupContract && parentHardening >= 0 && lookupMigration > parentHardening, "lookup migration must run after both source contracts and parent-session migration");
assert.ok(rls > lookupMigration, "lookup migration must precede Stage 7 runtime tests");
assert.ok(lookupRuntime > lookupMigration, "lookup runtime regression must run after migration");
assert.match(workflow.slice(lookupMigration, lookupRuntime), /127\.0\.0\.1:55432/);
assert.match(workflow.slice(lookupMigration, lookupRuntime), /20261123020000_stage7_harden_collective_portal_password_lookup\.sql/);
assert.match(workflow.slice(lookupRuntime, lookupRuntime + 1000), /127\.0\.0\.1:55432/);

for (const path of [
  "scripts/auth-migration/stage7-collective-portal-password-lookup.contract.test.mjs",
  "scripts/auth-migration/stage7-collective-portal-password-lookup-regression.sql",
  "supabase/migrations/20261123020000_stage7_harden_collective_portal_password_lookup.sql",
]) {
  assert.ok(workflow.includes("\"" + path + "\""), "workflow path filter must include " + path);
}

console.log("Stage 7 portal password lookup contract passed: all writers/verifier use one 64-bit account selector; zero-start preflight and owner-only helper ACL are pinned; rollback-only 5,000-key and wrong-suffix lockout regression are wired to the disposable baseline.");

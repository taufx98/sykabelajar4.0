import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const migration = read("supabase/migrations/20261123010000_stage7_harden_collective_portal_parent_sessions.sql");
const regression = read("scripts/auth-migration/stage7-collective-portal-valid-token-regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");

const helper = migration.match(
  /CREATE OR REPLACE FUNCTION private\.collective_session_participant\(p_token text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(helper, "missing child access token scope helper");
assert.match(helper, /VOLATILE/i);
assert.match(helper, /SECURITY DEFINER/i);
assert.match(helper, /SET search_path TO ''/i);
assert.match(helper, /JOIN public\.collective_portal_sessions AS ps/);
assert.match(helper, /JOIN public\.collective_portal_identities AS pi/);
assert.match(helper, /JOIN public\.collective_portal_credentials AS pc/);
assert.match(helper, /JOIN public\.collective_participants AS cp/);
assert.match(helper, /s\.portal_session_id IS NOT NULL/);
assert.match(helper, /ps\.revoked_at IS NULL/);
assert.match(helper, /ps\.expires_at>pg_catalog\.now\(\)/);
assert.match(helper, /pi\.status='ACTIVE'/);
assert.match(helper, /pc\.enabled IS TRUE/);
assert.match(helper, /pc\.password_version=ps\.credential_version/);
assert.match(helper, /cp\.status='ACTIVE'/);
assert.match(helper, /cp\.roster_student_id=pi\.roster_student_id/);
assert.match(helper, /cp\.managed_by_user_id=pi\.owner_user_id/);
assert.match(helper, /cp\.competition_id=s\.competition_id/);

const portalIdentity = migration.match(
  /CREATE OR REPLACE FUNCTION private\.collective_portal_identity\(p_token text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(portalIdentity);
assert.match(portalIdentity, /pi\.status='ACTIVE'/);
assert.match(portalIdentity, /pc\.enabled IS TRUE/);
assert.match(portalIdentity, /pc\.password_version=ps\.credential_version/);

const open = migration.match(
  /CREATE OR REPLACE FUNCTION public\.open_collective_competition_session\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(open, "missing portal child-token opening replacement");
assert.match(open, /LEAST\(v_portal_session\.expires_at,[\s\S]*?interval '8 hours'\)/,
  "child access token must never outlive its parent portal session");

const revoke = migration.match(
  /CREATE OR REPLACE FUNCTION public\.revoke_collective_portal_session\(p_portal_token text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(revoke);
assert.match(revoke, /UPDATE public\.collective_portal_sessions/);
assert.match(revoke, /UPDATE public\.collective_access_sessions/);
assert.match(revoke, /WHERE portal_session_id=v_session_id/);
assert.match(revoke, /revoked_at IS NULL/);

const certificate = migration.match(
  /CREATE OR REPLACE FUNCTION public\.get_collective_participant_certificate\(p_access_token text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(certificate);
assert.match(certificate, /VOLATILE/i);
assert.match(certificate, /s\.expires_at>pg_catalog\.now\(\)/);
assert.match(certificate, /private\.collective_session_participant\(p_access_token\)/);
assert.match(certificate, /cc\.competition_id=s\.competition_id/,
  "certificate lookup must stay inside the competition bound to the child access token");


const remainingPortalRpcs = [
  {
    signature: "public.list_collective_portal_competitions",
    definition: migration.match(/CREATE OR REPLACE FUNCTION public\.list_collective_portal_competitions\(p_portal_token text\)[\s\S]*?\$function\$;/i)?.[0] ?? "",
    required: [/VOLATILE/i, /SECURITY DEFINER/i, /SET search_path TO ''/i, /private\.hash_collective_token\(/i, /pg_catalog\.btrim\(/i, /pg_catalog\.now\(/i],
  },
  {
    signature: "public.revoke_collective_access_session",
    definition: migration.match(/CREATE OR REPLACE FUNCTION public\.revoke_collective_access_session\(p_access_token text\)[\s\S]*?\$function\$;/i)?.[0] ?? "",
    required: [/VOLATILE/i, /SECURITY DEFINER/i, /SET search_path TO ''/i, /private\.hash_collective_token\(/i, /pg_catalog\.btrim\(/i, /pg_catalog\.length\(/i, /pg_catalog\.now\(/i],
  },
  {
    signature: "public.verify_collective_portal_password",
    definition: migration.match(/CREATE OR REPLACE FUNCTION public\.verify_collective_portal_password\(p_password text\)[\s\S]*?\$function\$;/i)?.[0] ?? "",
    required: [/VOLATILE/i, /SECURITY DEFINER/i, /SET search_path TO ''/i, /extensions\.digest\(/i, /extensions\.crypt\(/i, /extensions\.gen_random_bytes\(/i, /pg_catalog\.encode\(/i, /pg_catalog\.jsonb_build_object\(/i],
  },
];
for (const rpc of remainingPortalRpcs) {
  assert.ok(rpc.definition, "missing hardened portal RPC: " + rpc.signature);
  for (const rule of rpc.required) assert.match(rpc.definition, rule, rpc.signature + " missing " + rule);
  assert.doesNotMatch(
    rpc.definition,
    /(?<![.\w])(?:trim|length|now|encode|left|crypt|digest|gen_random_bytes|jsonb_build_object)\s*\(/i,
    rpc.signature + " contains an unqualified function call under an empty search_path",
  );
}
for (const fingerprint of [
  "ea78645f37913438f2f0e300b1bdcdf9",
  "1e5abe9a8d31beef996ce1091045de2d",
  "d85f7c2a1d194151663b4c536c064dad",
]) {
  assert.ok(migration.includes(fingerprint), "missing exact Production function-definition preflight fingerprint: " + fingerprint);
}
assert.match(migration, /STAGE7_PORTAL_RPC_DEFINITION_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_RPC_SEARCH_PATH_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_RPC_PUBLIC_EXECUTE_BASELINE_DRIFT/);
assert.match(migration, /STAGE7_PORTAL_RPC_EMPTY_SEARCH_PATH_POSTCONDITION_FAILED/);
assert.match(migration, /STAGE7_PORTAL_RPC_EXECUTE_ACL_POSTCONDITION_DRIFT/);

assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
const executableMigration = migration.replace(/^--.*$/gm, "");
assert.doesNotMatch(executableMigration, /\b(?:GRANT|REVOKE)\b/i,
  "CREATE OR REPLACE must preserve the reviewed function ACLs; do not change grants here");
assert.doesNotMatch(executableMigration, /\b(?:CREATE|DROP)\s+POLICY\b/i);
assert.doesNotMatch(executableMigration, /\b(?:CREATE|DROP|ALTER)\s+TABLE\b/i);
assert.doesNotMatch(executableMigration, /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);

for (const marker of [
  "STAGE7_PARENT_REVOCATION_DID_NOT_REVOKE_CHILD",
  "STAGE7_CHILD_ACCESS_EXPIRY_EXCEEDS_PARENT",
  "STAGE7_DISABLED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED",
  "STAGE7_ROTATED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED",
  "STAGE7_SUSPENDED_PORTAL_IDENTITY_CHILD_TOKEN_ALLOWED",
  "STAGE7_EXPIRED_PARENT_SESSION_CHILD_TOKEN_ALLOWED",
]) {
  assert.ok(regression.includes(marker), "missing runtime parent-boundary assertion: " + marker);
}
assert.match(regression, /public\.revoke_collective_portal_session\(v_portal_token\)/);
assert.match(regression, /public\.get_collective_participant_certificate\(v_access_token\)/);
assert.match(regression, /ROLLBACK;/);

const applyStep = workflow.indexOf("- name: Apply Stage 7 portal parent-session hardening to disposable restore only");
const stage5 = workflow.indexOf("- name: Apply Stage 5 no-policy table ACL draft to disposable restore only");
const rls = workflow.indexOf("- name: Verify all 23 RLS table boundaries after Stage 5 on disposable restore");
const portal = workflow.indexOf("- name: Verify all 14 collective portal RPCs reject invalid anon tokens on disposable restore");
assert.ok(stage5 >= 0 && applyStep > stage5 && rls > applyStep && portal > rls,
  "portal session hardening must run only on the disposable restore after Stage 5 and before Stage 7 runtime tests");
assert.match(workflow.slice(applyStep, rls), /20261123010000_stage7_harden_collective_portal_parent_sessions\.sql/);

console.log("Stage 7 portal parent-session boundary contract passed: child tokens require live parent/identity/credential; parent revocation cascades and child expiry is bounded.");

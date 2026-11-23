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
assert.match(certificate, /s\.expires_at>pg_catalog\.now\(\)/);
assert.match(certificate, /private\.collective_session_participant\(p_access_token\)/);

assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE)\b/i,
  "CREATE OR REPLACE must preserve the reviewed function ACLs; do not change grants here");
assert.doesNotMatch(migration, /\b(?:CREATE|DROP)\s+POLICY\b/i);
assert.doesNotMatch(migration, /\b(?:CREATE|DROP|ALTER)\s+TABLE\b/i);
assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);

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

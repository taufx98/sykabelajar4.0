import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const inventory = JSON.parse(read("docs/security/AUTH-STAGE-7-RLS-NO-POLICY-INVENTORY-2026-11-21.json"));
const review = JSON.parse(read("docs/security/AUTH-STAGE-7-RLS-POLICY-REVIEW-2026-11-22.json"));
const stage5 = read("docs/security/AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql");
const regression = read("scripts/auth-migration/stage7-rls-policy-review-regression.sql");

const expected = inventory.tables
  .filter((t) => ["public", "private"].includes(t.schema))
  .map((t) => t.schema + "." + t.table)
  .sort();
const reviewed = review.tables.map((t) => t.schema + "." + t.table).sort();
assert.equal(expected.length, 23);
assert.deepEqual(reviewed, expected, "RLS review must classify each and only the 23 application tables.");
assert.equal(review.reviewed_table_count, 23);
assert.equal(review.application_table_count, 23);
assert.equal(review.status, "direct_table_acl_boundary_passed_disposable");
assert.equal(review.direct_table_boundary_acceptance.status, "passed_disposable_schema_only");
assert.equal(review.direct_table_boundary_acceptance.workflow_run_id, 45100444988);
assert.equal(review.direct_table_boundary_acceptance.commit, "feeefcfa3077adfcb6a1151cf03bb8bff75a5321");
assert.match(review.direct_table_boundary_acceptance.limitations.join(" "), /SECURITY DEFINER caller\/issuer\/token audit/);

for (const table of review.tables) {
  assert.equal(table.review_status, "direct_table_acl_boundary_passed_disposable");
  assert.equal(table.authorization_path_review_status, "pending_security_definer_audit");
  assert.equal(table.owner, "postgres", table.schema + "." + table.table + " owner drift");
  assert.equal(table.rls_enabled, true, table.schema + "." + table.table + " must retain RLS");
  assert.equal(table.policy_count, 0, table.schema + "." + table.table + " must remain policy-free");
  assert.ok(table.classification, "missing boundary classification: " + table.table);
  assert.ok(table.intended_boundary.length > 40, "missing rationale: " + table.table);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, [],
    "no direct browser table privileges are expected after Stage 5: " + table.table);
  assert.ok(Array.isArray(table.source_callers), "source caller evidence missing: " + table.table);
  assert.ok(table.positive_tests.length > 0, "positive test evidence missing: " + table.table);
  assert.ok(table.negative_tests.length > 0, "negative test evidence missing: " + table.table);
}

const chatTables = review.tables.filter((table) => table.table.startsWith("chat_group"));
assert.equal(chatTables.length, 5);
assert.equal(review.authorization_path_audit_summary.verified_tables, 5);
assert.equal(review.authorization_path_audit_summary.pending_tables, 18);
assert.equal(review.authorization_path_audit_summary.reviewed_at, "2026-11-26");
assert.deepEqual(review.authorization_path_audit_summary.retirement_source, {
  repository: "taufx98/sykabelajar4.0",
  ref: "main",
  path: "supabase/migrations/20261105053729_retire_chat_system.sql",
  blob_sha: "4628824aad895fa8419e49cf9b6774ab764f5592",
});
const stage3Regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
for (const table of chatTables) {
  const audit = table.authorization_path_review;
  assert.equal(table.authorization_path_review_status, "verified_retired_browser_access");
  assert.equal(audit.boundary, "retired_chat_browser_access");
  assert.equal(audit.browser_rpc_execute, "revoked_for_public_anon_authenticated");
  assert.equal(audit.direct_table_access, "revoked_for_public_anon_authenticated");
  assert.equal(audit.chat_realtime, "removed_from_supabase_realtime");
  assert.equal(audit.row_retention, "tables_and_rows_retained");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_table_acl_privileges_after_stage5_expected ?? table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  for (const caller of table.source_callers) {
    if (caller.signature === "public.admin_force_delete_competition(p_competition_id uuid, p_reason text)") {
      assert.equal(table.table, "chat_groups");
      assert.equal(caller.anon_execute, false);
      assert.equal(caller.authenticated_execute, true);
      assert.equal(caller.service_role_execute, true);
      continue;
    }
    assert.equal(caller.anon_execute, false, "retired chat caller must not expose anon EXECUTE: " + caller.signature);
    assert.equal(caller.authenticated_execute, false, "retired chat caller must not expose authenticated EXECUTE: " + caller.signature);
  }
}
const chatGroups = chatTables.find((table) => table.table === "chat_groups");
assert.deepEqual(chatGroups.authorization_path_review.exceptional_non_chat_callers, [{
  signature: "public.admin_force_delete_competition(p_competition_id uuid, p_reason text)",
  boundary: "better_auth_admin_only",
  tests: [
    "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_delete_competition",
    "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_delete_competition",
  ],
}]);
for (const marker of [
  "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_delete_competition",
  "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_delete_competition",
]) assert.ok(stage3Regression.includes(marker), "missing admin-force-delete issuer regression: " + marker);
for (const marker of [
  "STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_USAGE_REMAINS",
  "STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_USAGE_REMAINS",
  "STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_CREATE_REMAINS",
  "STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_CREATE_REMAINS",
]) assert.ok(regression.includes(marker), "missing private-schema runtime assertion: " + marker);

const stage5Tables = [...stage5.matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
for (const name of ["competition_status_history", "notification_deliveries", "supabase_system_logs"]) {
  assert.ok(stage5.includes("public." + name), "Stage 5 ACL draft must cover " + name);
  assert.ok(regression.includes("'" + name + "'"), "RLS regression must cover " + name);
}
assert.match(stage5, /REVOKE ALL ON TABLE[\s\S]*?FROM PUBLIC, anon, authenticated;/);
assert.match(stage5, /STAGE5_ACL_POSTCONDITION_TRUSTED_ROLE_ACCESS_LOST/);

for (const table of expected) {
  const [schema, name] = table.split(".");
  assert.ok(regression.includes("('" + schema + "','" + name + "'"),
    "read-only disposable regression is missing " + table);
}
assert.match(regression, /relrowsecurity/);
assert.match(regression, /STAGE7_RLS_REVIEW_POLICY_OR_RLS_DRIFT/);
assert.match(regression, /STAGE7_RLS_REVIEW_ANON_DIRECT_GRANT_REMAINS/);
assert.match(regression, /STAGE7_RLS_REVIEW_AUTHENTICATED_DIRECT_GRANT_REMAINS/);
assert.match(regression, /STAGE7_RLS_REVIEW_SERVICE_ROLE_ACCESS_LOST/);
assert.match(regression, /TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'/);
assert.match(regression, /BEGIN READ ONLY;/);
assert.match(regression, /ROLLBACK;/);
const executableSql = regression.replace(/^--.*$/gm, "");
assert.doesNotMatch(executableSql, /\b(?:CREATE|DROP)\s+POLICY\b/i);
assert.doesNotMatch(executableSql, /\b(?:GRANT|REVOKE)\b/i);
assert.doesNotMatch(executableSql, /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i);

console.log("Stage 7 RLS review contract passed: all 23 direct table ACL boundaries are accepted on the disposable restore; SECURITY DEFINER caller authorization remains a separate gate.");

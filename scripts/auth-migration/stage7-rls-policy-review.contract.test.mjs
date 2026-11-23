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

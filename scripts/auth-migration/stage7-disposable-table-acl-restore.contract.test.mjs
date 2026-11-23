import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../docs/security/AUTH-STAGE-7-DISPOSABLE-TABLE-ACL-RESTORE.sql", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/auth-schema-baseline.yml", import.meta.url),
  "utf8",
);

const expected = [
  "chat_group_collective_reads",
  "chat_group_invites",
  "chat_group_members",
  "chat_group_reads",
  "chat_groups",
  "collective_portal_credentials",
  "collective_portal_identities",
  "collective_portal_sessions",
  "exam_attempt_events",
  "exam_attempt_questions",
  "exam_attempt_runtime",
  "payment_gateway_configs",
  "payment_gateway_state",
  "shop_promo_banner_events",
  "shop_promo_banners",
  "shop_user_vouchers",
  "shop_voucher_definitions",
].sort();

const entries = [...sql.matchAll(/\('public', '([a-z_][a-z0-9_]*)'\)/g)]
  .map((match) => match[1])
  .sort();
assert.equal(entries.length, expected.length * 2,
  "preflight and postcondition must use exactly the same reviewed table allowlist");
assert.deepEqual(entries, [...expected, ...expected].sort(),
  "the same exact 17-table allowlist must be repeated for the preflight and postcondition");

const revoke = [...sql.matchAll(
  /REVOKE ALL PRIVILEGES ON TABLE %I\.%I FROM PUBLIC, anon, authenticated/g,
)];
assert.equal(revoke.length, 1, "the only mutation must revoke direct browser/PUBLIC privileges");
assert.match(sql, /STAGE7_DISPOSABLE_ACL_OWNER_DRIFT/);
assert.match(sql, /STAGE7_DISPOSABLE_ACL_RLS_DISABLED/);
assert.match(sql, /STAGE7_DISPOSABLE_ACL_POLICY_DRIFT/);
assert.match(sql, /STAGE7_DISPOSABLE_ACL_BROWSER_GRANT_REMAINS/);
assert.match(sql, /STAGE7_DISPOSABLE_ACL_TRUSTED_GRANT_LOST/);
assert.match(sql, /has_table_privilege\('service_role', v_oid, v_privilege\)/);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
assert.match(sql, /DISPOSABLE LOCAL DATABASE ONLY/);

for (const excluded of [
  "competition_status_history",
  "notification_deliveries",
  "supabase_system_logs",
]) {
  assert.doesNotMatch(sql, new RegExp("\\b" + excluded + "\\b"),
    excluded + " must remain for the canonical Stage 5 ACL draft");
}
assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|DROP TABLE|TRUNCATE TABLE)\b/i);
assert.doesNotMatch(sql, /GRANT\s+/i);
assert.doesNotMatch(sql, /FROM\s+service_role/i);

const step = workflow.indexOf("- name: Restore reviewed no-browser table ACLs in disposable restore only");
const restore = workflow.indexOf("- name: Restore schema into the disposable local Supabase database");
const stage5 = workflow.indexOf("- name: Apply Stage 5 no-policy table ACL draft to disposable restore only");
const verify = workflow.indexOf("- name: Verify all 23 RLS table boundaries after Stage 5 on disposable restore");
assert.ok(restore >= 0 && step > restore && stage5 > step && verify > stage5,
  "restore ACL parity only after schema restore and before Stage 5 and the 23-table verification");
assert.match(workflow.slice(step, stage5), /AUTH-STAGE-7-DISPOSABLE-TABLE-ACL-RESTORE\.sql/);

console.log("Stage 7 disposable table ACL restore contract passed: 17-table allowlist, exact browser-only revoke, trusted grants preserved, and correct workflow order.");

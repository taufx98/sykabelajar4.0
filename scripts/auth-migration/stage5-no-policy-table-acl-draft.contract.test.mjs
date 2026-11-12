import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const draft = readFileSync(
  new URL("../../docs/security/AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql", import.meta.url),
  "utf8",
);

const revokes = [...draft.matchAll(
  /REVOKE ALL ON TABLE\s+([\s\S]*?)\s+FROM PUBLIC, anon, authenticated;/gi,
)];
assert.equal(revokes.length, 1, "there must be exactly one narrowly scoped table privilege revoke");
const tableNames = [...revokes[0][1].matchAll(/public\.([a-z_][a-z0-9_]*)/gi)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(tableNames, [
  "competition_status_history",
  "notification_deliveries",
  "supabase_system_logs",
].sort(), "only the three reviewed no-policy tables may be changed");

assert.match(draft, /relrowsecurity IS DISTINCT FROM true/i);
assert.match(draft, /policy_count <> 0/i);
assert.match(draft, /STAGE5_ACL_PREFLIGHT_GRANT_DRIFT/i);
assert.match(draft, /has_table_privilege\('service_role'[\s\S]*?SELECT/i);
assert.match(draft, /has_table_privilege\('postgres'[\s\S]*?SELECT/i);
assert.match(draft, /STAGE5_ACL_POSTCONDITION_BROWSER_GRANT_REMAINS/i);
assert.match(draft, /STAGE5_ACL_POSTCONDITION_TRUSTED_ROLE_ACCESS_LOST/i);
assert.match(draft, /^BEGIN;[\s\S]*COMMIT;\s*$/i);
assert.doesNotMatch(draft, /\b(?:DROP TABLE|TRUNCATE TABLE|INSERT INTO|DELETE FROM)\b/i);
assert.doesNotMatch(draft, /GRANT\s+ALL[\s\S]*?TO\s+(?:PUBLIC|anon|authenticated)/i);
assert.doesNotMatch(draft, /FROM\s+service_role/i,
  "service_role privileges must not be revoked by this draft");

console.log("Stage 5 no-policy table ACL draft contract passed: three tables only; RLS stays enabled; service_role/postgres grants are preserved.");

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql", import.meta.url),
  "utf8",
);

const targetTables = [
  "public.competition_status_history",
  "public.notification_deliveries",
  "public.supabase_system_logs",
];

test("Stage 5 no-policy hardening used by Stage 7 is limited to three reviewed tables", () => {
  for (const table of targetTables) assert.ok(sql.includes(table), `missing reviewed table ${table}`);
  const revoke = sql.match(/REVOKE ALL ON TABLE([\s\S]*?)FROM PUBLIC, anon, authenticated;/i);
  assert.ok(revoke, "expected one explicit PUBLIC and browser-role revoke");
  for (const table of targetTables) assert.ok(revoke[1].includes(table));
  assert.equal((revoke[1].match(/public\./g) ?? []).length, 3);
  assert.match(revoke[0], /FROM PUBLIC, anon, authenticated;/i);
  assert.doesNotMatch(revoke[0], /service_role/i);
});

test("draft does not add policies, edit rows, alter schema, or weaken RLS", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "");
  assert.match(executableSql, /relrowsecurity/);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_OWNER_DRIFT/);
  assert.match(sql, /STAGE5_ACL_POSTCONDITION_OWNER_DRIFT/);
  assert.match(executableSql, /policy_count <> 0/);
  assert.doesNotMatch(executableSql, /CREATE\s+POLICY|DROP\s+POLICY/i);
  assert.doesNotMatch(executableSql, /ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+[^;]+SET/i);
  assert.match(executableSql, /BEGIN;/);
  assert.match(executableSql, /COMMIT;/);
});

test("preflight requires exact ownership, RLS/no-policy state and reviewed baseline grants", () => {
  assert.match(sql, /pg_get_userbyid\(c\.relowner\) AS table_owner/i);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_OWNER_DRIFT/);
  assert.match(sql, /STAGE5_ACL_POSTCONDITION_OWNER_DRIFT/);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_RLS_DISABLED/);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_POLICY_DRIFT/);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_GRANT_DRIFT/);
  for (const role of ["anon", "authenticated", "service_role", "postgres"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.match(sql, new RegExp("has_table_privilege\\('" + role + "', v_table\\.oid, '" + privilege + "'\\)"));
    }
  }
});

test("postflight denies PUBLIC/anon/authenticated CRUD and preserves service_role/postgres CRUD", () => {
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /STAGE5_ACL_POSTCONDITION_BROWSER_GRANT_REMAINS/);
  assert.match(sql, /STAGE5_ACL_POSTCONDITION_TRUSTED_ROLE_ACCESS_LOST/);
  assert.match(sql, /STAGE5_ACL_POSTCONDITION_PUBLIC_GRANT_REMAINS/);
  assert.match(sql, /STAGE5_ACL_PREFLIGHT_PUBLIC_GRANT_DRIFT/);
  assert.match(sql, /acl\\.grantee = 0/);
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      assert.match(sql, new RegExp("has_table_privilege\\\\('" + role + "', v_table\\\\.oid, '" + privilege + "'\\\\)"));
    }
  }
  for (const role of ["anon", "authenticated", "service_role", "postgres"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.match(sql, new RegExp("has_table_privilege\\('" + role + "', v_table\\.oid, '" + privilege + "'\\)"));
    }
  }
});

test("the SQL remains outside migrations and requires explicit acceptance before Production", () => {
  assert.match(sql, /Do not apply to Production/i);
  assert.ok(sql.includes("before separate Stage 5/6/7 acceptance and explicit cutover authorization"));
  assert.ok(sql.includes("Current application access uses trusted database functions/triggers and"));
  assert.ok(sql.includes("server-side service_role paths"));
});

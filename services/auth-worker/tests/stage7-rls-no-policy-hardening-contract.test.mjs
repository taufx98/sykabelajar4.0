import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-7-RLS-NO-POLICY-HARDENING-DRAFT.sql", import.meta.url),
  "utf8",
);

const targetTables = [
  "public.competition_status_history",
  "public.notification_deliveries",
  "public.supabase_system_logs",
];

test("Stage 7 no-policy hardening is limited to the three reviewed public tables", () => {
  for (const table of targetTables) {
    assert.ok(sql.includes(table), `missing reviewed table ${table}`);
  }

  const revoke = sql.match(/REVOKE ALL PRIVILEGES ON TABLE([\s\S]*?)FROM anon, authenticated;/i);
  assert.ok(revoke, "expected one explicit browser-role revoke");
  for (const table of targetTables) assert.ok(revoke[1].includes(table));
  assert.equal((revoke[1].match(/public\./g) ?? []).length, 3);
  assert.doesNotMatch(revoke[0], /service_role|PUBLIC/i);
});

test("draft does not add policies, edit rows, alter schema, or weaken RLS", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "");
  assert.match(executableSql, /relrowsecurity/);
  assert.match(executableSql, /policy_count <> 0/);
  assert.doesNotMatch(executableSql, /CREATE\s+POLICY|DROP\s+POLICY/i);
  assert.doesNotMatch(executableSql, /ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+[^;]+SET/i);
  assert.match(executableSql, /BEGIN;/);
  assert.match(executableSql, /COMMIT;/);
});

test("preflight requires the exact owner, RLS state, no-policy state and reviewed baseline grants", () => {
  assert.match(sql, /UNEXPECTED_OWNER/);
  assert.match(sql, /RLS_DISABLED/);
  assert.match(sql, /POLICY_DRIFT/);
  assert.match(sql, /GRANT_DRIFT/);
  assert.match(sql, /has_table_privilege\('anon'/);
  assert.match(sql, /has_table_privilege\('authenticated'/);
  assert.match(sql, /has_table_privilege\('service_role'/);
});

test("postflight denies all browser CRUD and preserves service_role CRUD", () => {
  assert.ok(sql.includes(`ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']`));
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`has_table_privilege\\('${role}', v_table, v_privilege\\)`));
  }
});

test("the SQL remains a gated draft and never auto-runs against Production", () => {
  assert.match(sql, /DO NOT RUN/);
  assert.match(sql, /off-GitHub full backup checksum/i);
  assert.match(sql, /owner approves this exact privilege-only DDL operation/i);
});

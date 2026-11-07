import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const exporter = readFileSync(new URL("./export-live-auth-users-fk-plan.sh", import.meta.url), "utf8");

test("live FK catalog exporter is bound to the audited production project and known FK shape", () => {
  assert.match(exporter, /SUPABASE_PROJECT_REF/);
  assert.match(exporter, /EXPECTED_PROJECT_REF="mvdczyitbkxkldjughor"/);
  assert.match(exporter, /EXPECTED_FK_COUNT=69/);
  assert.match(exporter, /sourceTables\.size !== 62/);
  assert.match(exporter, /target_ns\.nspname = 'auth'/);
  assert.match(exporter, /target_table\.relname = 'users'/);
  assert.match(exporter, /source_ns\.nspname IN \('public', 'private'\)/);
});

test("live FK catalog query is read-only and does not export application rows", () => {
  assert.match(exporter, /BEGIN READ ONLY;/);
  assert.match(exporter, /FROM pg_constraint AS c/);
  assert.match(exporter, /pg_namespace/);
  assert.match(exporter, /pg_attribute/);
  assert.doesNotMatch(exporter, /INSERT INTO\s+|UPDATE\s+[^ ]+\s+SET\s+|DELETE FROM\s+|CREATE TABLE\s+|ALTER TABLE\s+|DROP TABLE\s+/i);
  assert.match(exporter, /source: "read-only pg_catalog snapshot; no application rows exported"/);
});

test("database URI is not passed in process arguments and temporary password file is private", () => {
  assert.match(exporter, /process\.env\.SUPABASE_DB_URL/);
  assert.match(exporter, /PGPASSFILE/);
  assert.match(exporter, /mode: 0o600/);
  assert.match(exporter, /\$PGPASSFILE/);
  assert.doesNotMatch(exporter, /psql\s+["']?\$SUPABASE_DB_URL/);
  assert.match(exporter, /directHost/);
  assert.match(exporter, /poolerHost/);
  assert.match(exporter, /PGSSLMODE=require/);
});

test("review plan is written outside the repository and never executed", () => {
  assert.match(exporter, /out-dir/);
  assert.match(exporter, /must be outside the Git repository/);
  assert.match(exporter, /generate-app-users-fk-plan\.mjs/);
  assert.match(exporter, /--catalog/);
  assert.match(exporter, /--out-dir/);
  assert.match(exporter, /It is a review-only plan/);
  assert.doesNotMatch(exporter, /psql[^\n]*03-cutover|bash[^\n]*03-cutover|exec[^\n]*\.sql/i);
});

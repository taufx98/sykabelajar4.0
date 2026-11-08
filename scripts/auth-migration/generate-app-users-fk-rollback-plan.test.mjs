import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRollbackPlan } from "./generate-app-users-fk-rollback-plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, "live-auth-users-fk-catalog.json"), "utf8"));
const records = catalog.foreign_keys;
const plan = generateRollbackPlan(catalog);
const expand = plan["01-preflight-expand-auth-rollback.sql"];
const validate = plan["02-validate-auth-rollback.sql"];
const cutover = plan["03-cutover-auth-rollback.sql"];

assert.ok(expand && validate && cutover, "all reverse phases must be generated");
assert.equal((expand.match(/ADD CONSTRAINT/g) ?? []).length, 69);
assert.equal((validate.match(/VALIDATE CONSTRAINT/g) ?? []).length, 69);
assert.equal((cutover.match(/DROP CONSTRAINT/g) ?? []).length, 69);
assert.equal((cutover.match(/RENAME CONSTRAINT/g) ?? []).length, 69);

const tableCount = new Set(records.map((fk) => fk.source_schema + "." + fk.source_table)).size;
assert.equal(tableCount, 62);
assert.equal((expand.match(/^BEGIN;$/gm) ?? []).length, tableCount,
  "reverse expansion is committed in bounded source-table batches");
assert.equal((validate.match(/^BEGIN;$/gm) ?? []).length, tableCount,
  "reverse validation is committed in bounded source-table batches");
assert.equal((cutover.match(/^BEGIN;$/gm) ?? []).length, 1,
  "reverse cutover is one atomic transaction");

assert.match(expand, /ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS/,
  "rollback must stop if any Better Auth-only identity has no auth.users row");
assert.match(expand, /LEFT JOIN auth[.]users AS legacy_user/);
assert.match(expand, /ROLLBACK_AUTH_USER_ORPHANS:/);
assert.match(expand, /ROLLBACK_CURRENT_APP_USERS_FK_DRIFT:/);
assert.match(expand, /ROLLBACK_TEMP_FK_NAME_COLLISION:/);
assert.match(validate, /ROLLBACK_REPLACEMENT_FK_MISSING:/);
assert.match(validate, /convalidated/);
assert.match(cutover, /ROLLBACK_FK_NOT_VALIDATED_OR_SEMANTICS_CHANGED:/);
assert.match(cutover, /ROLLBACK_CURRENT_FK_MISSING_OR_SEMANTICS_CHANGED:/);
assert.match(cutover, /ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS/,
  "the atomic cutover repeats the no-shadow-identity safety guard");

for (const sql of Object.values(plan)) {
  assert.match(sql, /GENERATED FK ROLLBACK REVIEW PLAN ONLY/);
  assert.match(sql, /lock_timeout/);
  assert.match(sql, /statement_timeout/);
  assert.match(sql, /Never create shadow auth[.]users rows/);
  assert.doesNotMatch(sql, /(?:^|[;\\n])[\\s]*(?:INSERT\\s+INTO|UPDATE\\s+"?[a-z_][a-z0-9_]*"?\\s+SET|DELETE\\s+FROM|COPY\\s+)/im,
    "rollback plan must never contain executable application-row DML or COPY commands");
}

for (const action of ["CASCADE", "SET NULL", "NO ACTION", "RESTRICT"]) {
  assert.ok(expand.includes("ON DELETE " + action),
    "reverse expansion must preserve ON DELETE " + action);
}

const synthetic = {
  foreign_keys: [{
    name: "sample_cascade_fkey", source_schema: "public", source_table: "sample_a",
    source_columns: ["user_id"], target_schema: "auth", target_table: "users",
    target_columns: ["id"], match_type: "SIMPLE", on_update: "NO ACTION",
    on_delete: "CASCADE", deferrable: false, initially_deferred: false, validated: true,
  }],
};
assert.doesNotThrow(() => generateRollbackPlan(synthetic));
assert.throws(() => generateRollbackPlan({
  ...synthetic,
  foreign_keys: [{ ...synthetic.foreign_keys[0], name: "sample; DROP TABLE auth.users" }],
}), /Unsafe or invalid SQL identifier/);

console.log("Identity FK rollback plan contract passed: 69 reverse relationships, strict no-shadow identity guard, preserved FK semantics, bounded phases, no database execution.");

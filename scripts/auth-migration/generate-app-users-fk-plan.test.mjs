import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan, validateCatalog } from "./generate-app-users-fk-plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, "live-auth-users-fk-catalog.json"), "utf8"));
const records = validateCatalog(catalog);

assert.equal(records.length, 69, "the committed production snapshot must contain exactly 69 FKs");
assert.deepEqual(
  records.reduce((counts, fk) => {
    counts[fk.on_delete] = (counts[fk.on_delete] ?? 0) + 1;
    return counts;
  }, {}),
  { CASCADE: 42, "NO ACTION": 8, "SET NULL": 18, RESTRICT: 1 },
  "the generator must preserve the live delete-action distribution",
);

const plan = generatePlan(catalog);
const expand = plan["01-preflight-expand.sql"];
const validate = plan["02-validate.sql"];
const cutover = plan["03-cutover.sql"];

const tombstones = plan["00-identity-tombstones.sql"];
assert.ok(tombstones && expand && validate && cutover, "the identity tombstone seed and all three FK phases must be generated");
assert.equal((tombstones.match(/SELECT [^\n]+ AS id FROM/g) ?? []).length, 69,
  "every reviewed FK source column must contribute to the legacy-reference tombstone query");
assert.match(tombstones, /INSERT INTO private\.app_users \(id, identity_origin\)/);
assert.match(tombstones, /'legacy_reference'/);
assert.match(tombstones, /ON CONFLICT \(id\) DO NOTHING/);
const tombstoneStatements = tombstones.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
assert.doesNotMatch(tombstoneStatements, /auth\.users|email|password|credential|session|role/i,
  "the tombstone seed must never read or copy account or authentication data");
assert.equal((expand.match(/ADD CONSTRAINT/g) ?? []).length, 69);
assert.equal((validate.match(/VALIDATE CONSTRAINT/g) ?? []).length, 69);
assert.equal((cutover.match(/DROP CONSTRAINT/g) ?? []).length, 69);
assert.equal((cutover.match(/RENAME CONSTRAINT/g) ?? []).length, 69);

const sourceTableCount = new Set(records.map((fk) => fk.source_schema + "." + fk.source_table)).size;
assert.equal(sourceTableCount, 62);
assert.equal((expand.match(/^BEGIN;$/gm) ?? []).length, sourceTableCount,
  "each source table must expand in its own committed transaction");
assert.equal((validate.match(/^BEGIN;$/gm) ?? []).length, sourceTableCount,
  "each source table must validate in its own committed transaction");
assert.equal((cutover.match(/^BEGIN;$/gm) ?? []).length, 1,
  "the FK cutover must remain one globally atomic transaction");
assert.match(expand, /current_setting\('lock_timeout'\)/);
assert.match(expand, /current_setting\('statement_timeout'\)/);
assert.match(expand, /TEMP_FK_NAME_COLLISION:/);
assert.match(expand, /REPLACEMENT_FK_SEMANTIC_DRIFT:/);
assert.match(validate, /REPLACEMENT_FK_MISSING:/);
assert.match(validate, /convalidated/);
assert.match(cutover, /REPLACEMENT_FK_NOT_VALIDATED_OR_SEMANTICS_CHANGED:/);
assert.doesNotMatch(expand, /IDENTITY_ROOT_MISSING_LEGACY_USERS|FROM auth\.users/,
  "the FK cutover must not require migrating every old Auth account");
assert.match(expand, /IDENTITY_ROOT_ORPHANS:/);
assert.match(expand, /LIVE_FK_DRIFT:/);
assert.match(expand, /TEMP_FK_NAME_COLLISION:/);
assert.match(expand, /ON UPDATE NO ACTION/);
assert.match(expand, /ON DELETE SET NULL/);
assert.match(cutover, /REPLACEMENT_FK_NOT_VALIDATED_OR_SEMANTICS_CHANGED:/);
assert.match(cutover, /LEGACY_FK_MISSING_OR_SEMANTICS_CHANGED:/);

for (const sql of [expand, validate, cutover]) {
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|COPY\s+)\b/i);
  assert.match(sql, /GENERATED REVIEW PLAN ONLY/);
}

const fixture = {
  foreign_keys: [
    {
      name: "sample_cascade_fkey", source_schema: "public", source_table: "sample_a",
      source_columns: ["user_id"], target_schema: "auth", target_table: "users",
      target_columns: ["id"], match_type: "SIMPLE", on_update: "NO ACTION",
      on_delete: "CASCADE", deferrable: false, initially_deferred: false, validated: true,
    },
  ],
};
assert.equal(validateCatalog(fixture).length, 1);
assert.throws(() => validateCatalog({ ...fixture, foreign_keys: [{ ...fixture.foreign_keys[0], source_table: "sample; DROP TABLE users" }] }), /Unsafe or invalid SQL identifier/);
assert.throws(() => validateCatalog({ ...fixture, foreign_keys: [{ ...fixture.foreign_keys[0], source_columns: ["user_id", "other_id"] }] }), /exactly one source column/);
assert.throws(() => validateCatalog({ ...fixture, foreign_keys: [{ ...fixture.foreign_keys[0], target_table: "profiles" }] }), /does not reference auth.users/);
assert.throws(() => validateCatalog({ ...fixture, foreign_keys: [{ ...fixture.foreign_keys[0], on_delete: "UNKNOWN" }] }), /unsupported ON DELETE/);
assert.throws(() => validateCatalog({ ...fixture, foreign_keys: [{ ...fixture.foreign_keys[0], validated: false }] }), /validated, non-deferrable/);

console.log("Identity FK plan generator contract passed: 69 live constraints, UUID-only tombstones, exact delete semantics, three gated FK phases, no DB execution.");

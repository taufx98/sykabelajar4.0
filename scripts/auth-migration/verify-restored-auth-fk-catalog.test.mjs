import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRestoredAuthFkCatalog } from "./verify-restored-auth-fk-catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, "live-auth-users-fk-catalog.json"), "utf8"));

const baseline = verifyRestoredAuthFkCatalog(catalog.foreign_keys, catalog);
assert.equal(baseline.foreignKeys, 69);
assert.equal(baseline.sourceTables, 62);
assert.deepEqual(baseline.deleteActions, {
  CASCADE: 42,
  "NO ACTION": 8,
  "SET NULL": 18,
  RESTRICT: 1,
});

// Row ordering is not semantically meaningful.
assert.equal(
  verifyRestoredAuthFkCatalog([...catalog.foreign_keys].reverse(), catalog).foreignKeys,
  69,
);

// Changes to names, target, columns, null-action semantics, or validation state must stop the plan.
const changedAction = catalog.foreign_keys.map((fk, index) =>
  index === 0 ? { ...fk, on_delete: "SET NULL" } : fk
);
assert.throws(() => verifyRestoredAuthFkCatalog(changedAction, catalog), /delete-action distribution changed|differs from the reviewed production snapshot/);

assert.throws(() =>
  verifyRestoredAuthFkCatalog(catalog.foreign_keys.slice(1), catalog),
  /exactly 69/
);

const changedTarget = catalog.foreign_keys.map((fk, index) =>
  index === 0 ? { ...fk, target_table: "profiles" } : fk
);
assert.throws(() => verifyRestoredAuthFkCatalog(changedTarget, catalog), /differs from the reviewed production snapshot/);

assert.throws(() =>
  verifyRestoredAuthFkCatalog(catalog.foreign_keys.map((fk, index) =>
    index === 0 ? { ...fk, validated: false } : fk
  ), catalog),
  /differs from the reviewed production snapshot/
);

assert.throws(() =>
  verifyRestoredAuthFkCatalog(catalog.foreign_keys, { ...catalog, project_ref: "ydamszdfsxqisanazdkb" }),
  /reviewed production project/
);

console.log("Restored Auth FK catalog verifier tests passed: exact 69-row match, semantic drift rejection, and production-project guard.");

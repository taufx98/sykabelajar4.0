import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fields = [
  "name",
  "on_delete",
  "on_update",
  "validated",
  "deferrable",
  "match_type",
  "source_table",
  "target_table",
  "source_schema",
  "target_schema",
  "source_columns",
  "target_columns",
  "initially_deferred",
];

function normalizeRecord(record) {
  const normalized = {};
  for (const field of fields) normalized[field] = record[field];
  return normalized;
}

function sortRecords(records) {
  return records.map(normalizeRecord).sort((a, b) => {
    const left = a.source_schema + "." + a.source_table + "." + a.name;
    const right = b.source_schema + "." + b.source_table + "." + b.name;
    return left.localeCompare(right);
  });
}

export function verifyRestoredAuthFkCatalog(actualRecords, expectedCatalog) {
  assert.ok(Array.isArray(actualRecords), "The restored FK query must return a JSON array.");
  assert.ok(Array.isArray(expectedCatalog?.foreign_keys), "The committed FK snapshot is invalid.");
  assert.equal(expectedCatalog.project_ref, "mvdczyitbkxkldjughor",
    "The committed FK snapshot must identify the reviewed production project.");

  const expected = sortRecords(expectedCatalog.foreign_keys);
  const actual = sortRecords(actualRecords);

  assert.equal(actual.length, 69, "The restored database must contain exactly 69 application FKs to auth.users.");
  assert.equal(expected.length, 69, "The reviewed production snapshot must contain exactly 69 FKs.");
  const sourceTables = new Set(actual.map((fk) => fk.source_schema + "." + fk.source_table));
  assert.equal(sourceTables.size, 62, "The restored FK set must span exactly 62 application tables.");

  const deleteActions = actual.reduce((counts, fk) => {
    counts[fk.on_delete] = (counts[fk.on_delete] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(deleteActions, {
    CASCADE: 42,
    "NO ACTION": 8,
    "SET NULL": 18,
    RESTRICT: 1,
  }, "The restored FK delete-action distribution changed.");

  for (let i = 0; i < expected.length; i += 1) {
    assert.deepEqual(actual[i], expected[i],
      "Restored FK catalog differs from the reviewed production snapshot at sorted row " + (i + 1) + ".");
  }

  for (const fk of actual) {
    assert.equal(fk.target_schema, "auth");
    assert.equal(fk.target_table, "users");
    assert.deepEqual(fk.target_columns, ["id"]);
    assert.equal(fk.on_update, "NO ACTION");
    assert.equal(fk.match_type, "SIMPLE");
    assert.equal(fk.validated, true);
    assert.equal(fk.deferrable, false);
    assert.equal(fk.initially_deferred, false);
    assert.equal(fk.source_columns.length, 1,
      "Composite application FKs require manual review and cannot be rehomed automatically.");
  }

  return {
    foreignKeys: actual.length,
    sourceTables: sourceTables.size,
    deleteActions,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--actual") args.actual = argv[++i];
    else if (argv[i] === "--expected") args.expected = argv[++i];
    else throw new Error("Unknown argument: " + argv[i]);
  }
  if (!args.actual || !args.expected) {
    throw new Error("Usage: node verify-restored-auth-fk-catalog.mjs --actual <restored-json> --expected <reviewed-catalog-json>");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const actual = JSON.parse(readFileSync(args.actual, "utf8"));
  const expected = JSON.parse(readFileSync(args.expected, "utf8"));
  const result = verifyRestoredAuthFkCatalog(actual, expected);
  process.stdout.write(
    "Restored production FK catalog matches the reviewed snapshot exactly: " +
    result.foreignKeys + " constraints across " + result.sourceTables + " tables.\n" +
    "Delete actions preserved: " + Object.entries(result.deleteActions)
      .map(([action, count]) => action + "=" + count).join(", ") + ".\n"
  );
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  });
}

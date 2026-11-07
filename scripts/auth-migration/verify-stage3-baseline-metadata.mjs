import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const EXPECTED_COUNTS = {
  auth_dependent_functions: 10,
  auth_and_profile_triggers: 7,
  uid_policies: 109,
  uid_policy_tables: 61,
  profile_columns: 36,
};

export function verifyStage3BaselineMetadata(production, restored) {
  assert.ok(production && typeof production === "object" && !Array.isArray(production),
    "Production metadata must be a JSON object.");
  assert.ok(restored && typeof restored === "object" && !Array.isArray(restored),
    "Restored metadata must be a JSON object.");

  for (const [section, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
    assert.ok(Array.isArray(production[section]), "Production metadata section missing: " + section);
    assert.ok(Array.isArray(restored[section]), "Restored metadata section missing: " + section);
    assert.equal(production[section].length, expectedCount,
      "Production metadata count changed for " + section + ".");
    assert.equal(restored[section].length, expectedCount,
      "Restored metadata count changed for " + section + ".");
  }

  assert.deepStrictEqual(restored, production,
    "Restored Stage 3 function/trigger/RLS/profile metadata differs from the production snapshot.");

  return {
    functions: restored.auth_dependent_functions.length,
    triggers: restored.auth_and_profile_triggers.length,
    policies: restored.uid_policies.length,
    policyTables: restored.uid_policy_tables.length,
    profileColumns: restored.profile_columns.length,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--production") args.production = argv[++index];
    else if (argv[index] === "--restored") args.restored = argv[++index];
    else throw new Error("Unknown argument: " + argv[index]);
  }
  if (!args.production || !args.restored) {
    throw new Error("Usage: node verify-stage3-baseline-metadata.mjs --production <metadata.json> --restored <metadata.json>");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const production = JSON.parse(readFileSync(args.production, "utf8"));
  const restored = JSON.parse(readFileSync(args.restored, "utf8"));
  const result = verifyStage3BaselineMetadata(production, restored);
  process.stdout.write(
    "Restored Stage 3 metadata matches production exactly: " +
    result.functions + " Auth-dependent functions, " +
    result.triggers + " Auth/profile triggers, " +
    result.policies + " auth.uid() policies across " +
    result.policyTables + " tables, and " +
    result.profileColumns + " profile columns.\n"
  );
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  });
}

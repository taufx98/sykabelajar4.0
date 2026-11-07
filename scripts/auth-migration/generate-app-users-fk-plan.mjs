#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DELETE_ACTIONS = new Set(["CASCADE", "SET NULL", "NO ACTION", "RESTRICT", "SET DEFAULT"]);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function quoteIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error("Unsafe or invalid SQL identifier in " + label);
  }
  return '"' + value + '"';
}

function quoteLiteral(value) {
  if (typeof value !== "string") throw new Error("Expected string literal");
  return "'" + value.replaceAll("'", "''") + "'";
}

/**
 * Validate the live catalog snapshot before any SQL is generated.
 * The production snapshot is intentionally constrained to 69 single-column
 * references from public/private to auth.users(id).
 */
export function validateCatalog(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.foreign_keys)) {
    throw new Error("Catalog must contain a foreign_keys array");
  }

  const records = [...snapshot.foreign_keys].sort((a, b) =>
    [a.source_schema, a.source_table, a.name].join(".")
      .localeCompare([b.source_schema, b.source_table, b.name].join(".")),
  );
  if (snapshot.project_ref && records.length !== 69) {
    throw new Error("Expected 69 production FK records; received " + records.length);
  }

  const seen = new Set();
  for (const [index, fk] of records.entries()) {
    const label = "foreign_keys[" + index + "]";
    quoteIdentifier(fk.name, label + ".name");
    quoteIdentifier(fk.source_schema, label + ".source_schema");
    quoteIdentifier(fk.source_table, label + ".source_table");

    if (!["public", "private"].includes(fk.source_schema)) {
      throw new Error(label + " has an unsupported source schema");
    }
    if (fk.target_schema !== "auth" || fk.target_table !== "users") {
      throw new Error(label + " does not reference auth.users");
    }
    if (!Array.isArray(fk.source_columns) || fk.source_columns.length !== 1) {
      throw new Error(label + " must have exactly one source column");
    }
    if (!Array.isArray(fk.target_columns) || fk.target_columns.length !== 1 || fk.target_columns[0] !== "id") {
      throw new Error(label + " must reference auth.users(id)");
    }
    quoteIdentifier(fk.source_columns[0], label + ".source_columns[0]");
    if (fk.match_type !== "SIMPLE" || fk.on_update !== "NO ACTION") {
      throw new Error(label + " has unexpected MATCH or ON UPDATE semantics");
    }
    if (!DELETE_ACTIONS.has(fk.on_delete)) {
      throw new Error(label + " has an unsupported ON DELETE action");
    }
    if (fk.deferrable !== false || fk.initially_deferred !== false || fk.validated !== true) {
      throw new Error(label + " does not match the validated, non-deferrable production FK baseline");
    }
    const key = fk.source_schema + "." + fk.source_table + "." + fk.name;
    if (seen.has(key)) throw new Error("Duplicate FK identity: " + key);
    seen.add(key);
  }

  return records;
}

function temporaryName(fk, index) {
  const source = [fk.source_schema, fk.source_table, fk.name].join(".");
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 10);
  return "ba_app_users_fk_" + String(index + 1).padStart(3, "0") + "_" + digest;
}

function relation(fk) {
  return quoteIdentifier(fk.source_schema, "source_schema") + "." +
    quoteIdentifier(fk.source_table, "source_table");
}

function orphanCheck(fk) {
  const column = quoteIdentifier(fk.source_columns[0], "source_column");
  return `  IF EXISTS (
    SELECT 1
    FROM ${relation(fk)} AS child
    LEFT JOIN private.app_users AS identity_root
      ON identity_root.id = child.${column}
    WHERE child.${column} IS NOT NULL
      AND identity_root.id IS NULL
  ) THEN
    RAISE EXCEPTION ${quoteLiteral("IDENTITY_ROOT_ORPHANS: " + fk.source_schema + "." + fk.source_table + "." + fk.source_columns[0])};
  END IF;`;
}

/**
 * Generate review-only SQL in three independently reviewable steps:
 * 1) preflight + add replacement constraints NOT VALID,
 * 2) validate each replacement constraint,
 * 3) drop old auth.users constraints and rename validated replacements.
 */
function groupBySourceTable(records) {
  const groups = new Map();
  for (const fk of records) {
    const key = fk.source_schema + "." + fk.source_table;
    const group = groups.get(key) ?? [];
    group.push(fk);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, foreignKeys]) => ({ key, foreignKeys }));
}

function deleteActionCode(action) {
  return { CASCADE: "c", "SET NULL": "n", "NO ACTION": "a", RESTRICT: "r", "SET DEFAULT": "d" }[action];
}

function replacementConstraintQuery(fk, index, requireValidated = false) {
  const rel = quoteLiteral(fk.source_schema + "." + fk.source_table);
  const tempName = quoteLiteral(temporaryName(fk, index));
  const sourceColumn = quoteLiteral(fk.source_columns[0]);
  const deleteCode = deleteActionCode(fk.on_delete);
  return [
    "SELECT 1 FROM pg_constraint AS c",
    "WHERE c.conrelid = " + rel + "::regclass",
    "  AND c.conname = " + tempName,
    "  AND c.contype = 'f'",
    "  AND c.confrelid = 'private.app_users'::regclass",
    "  AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = " + rel + "::regclass AND attname = " + sourceColumn + ")]::smallint[]",
    "  AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'private.app_users'::regclass AND attname = 'id')]::smallint[]",
    "  AND c.confmatchtype = 's'",
    "  AND c.confupdtype = 'a'",
    "  AND c.confdeltype = '" + deleteCode + "'",
    "  AND NOT c.condeferrable",
    "  AND NOT c.condeferred" + (requireValidated ? "\n  AND c.convalidated" : ""),
  ].join("\n");
}

function boundedTimeoutGuard() {
  return [
    "DO $$",
    "BEGIN",
    "  IF pg_catalog.current_setting('lock_timeout') = '0' THEN",
    "    RAISE EXCEPTION 'AUTH_FK_LOCK_TIMEOUT_MUST_BE_SET';",
    "  END IF;",
    "  IF pg_catalog.current_setting('statement_timeout') = '0' THEN",
    "    RAISE EXCEPTION 'AUTH_FK_STATEMENT_TIMEOUT_MUST_BE_SET';",
    "  END IF;",
    "END",
    "$$;",
  ].join("\n");
}

/**
 * Generate review-only SQL in three phases:
 * 1) full preflight + resumable, bounded per-source-table expansion batches,
 * 2) resumable, bounded per-source-table validation batches,
 * 3) one globally atomic cutover after all replacement constraints validate.
 *
 * The operator must set finite lock_timeout and statement_timeout values on
 * the psql session after measuring the current workload. This generator does
 * not guess production timeout values and never connects to a database.
 */
export function generatePlan(snapshot) {
  const records = validateCatalog(snapshot);
  const tableGroups = groupBySourceTable(records);
  const stamp = snapshot.generated_at ?? "unknown";
  const header = (phase) => [
    "-- GENERATED REVIEW PLAN ONLY — DO NOT APPLY WITHOUT COMPLETE SCHEMA REVIEW.",
    "-- Live catalog snapshot: " + stamp,
    "-- Source: " + (snapshot.project_ref ?? "synthetic fixture"),
    "-- Phase: " + phase,
    "-- This generator never connects to a database and never executes SQL.",
    "-- REQUIRED: Set finite session lock_timeout and statement_timeout values",
    "-- chosen from current workload measurements before running this file.",
    "-- Do not invoke psql with --single-transaction: expand/validate commits are",
    "-- intentionally bounded one-source-table batches for safe resume/reconciliation.",
    "",
  ].join("\n");

  const preflightChecks = [
    [
      "  IF to_regclass('auth.users') IS NULL THEN",
      "    RAISE EXCEPTION 'EXPECTED_AUTH_USERS_TABLE_MISSING';",
      "  END IF;",
      "  IF to_regclass('private.app_users') IS NULL THEN",
      "    RAISE EXCEPTION 'IDENTITY_ROOT_PRIVATE_APP_USERS_MISSING';",
      "  END IF;",
      "  IF EXISTS (",
      "    SELECT 1 FROM auth.users AS legacy_user",
      "    LEFT JOIN private.app_users AS identity_root ON identity_root.id = legacy_user.id",
      "    WHERE identity_root.id IS NULL",
      "  ) THEN",
      "    RAISE EXCEPTION 'IDENTITY_ROOT_MISSING_LEGACY_USERS';",
      "  END IF;",
    ].join("\n"),
    ...records.flatMap((fk, index) => {
      const rel = quoteLiteral(fk.source_schema + "." + fk.source_table);
      const tempName = temporaryName(fk, index);
      const sourceColumn = quoteLiteral(fk.source_columns[0]);
      const deleteCode = deleteActionCode(fk.on_delete);
      const replacementQuery = replacementConstraintQuery(fk, index);
      const oldFkCheck = [
        "  IF NOT EXISTS (",
        "    SELECT 1 FROM pg_constraint AS c",
        "    WHERE c.conrelid = " + rel + "::regclass",
        "      AND c.conname = " + quoteLiteral(fk.name),
        "      AND c.contype = 'f'",
        "      AND c.confrelid = 'auth.users'::regclass",
        "      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = " + rel + "::regclass AND attname = " + sourceColumn + ")]::smallint[]",
        "      AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'auth.users'::regclass AND attname = 'id')]::smallint[]",
        "      AND c.confmatchtype = 's'",
        "      AND c.confupdtype = 'a'",
        "      AND c.confdeltype = '" + deleteCode + "'",
        "      AND NOT c.condeferrable",
        "      AND NOT c.condeferred",
        "      AND c.convalidated",
        "  ) THEN",
        "    RAISE EXCEPTION " + quoteLiteral("LIVE_FK_DRIFT: " + fk.name) + ";",
        "  END IF;",
      ].join("\n");
      const tempFkCheck = [
        "  IF EXISTS (",
        "    SELECT 1 FROM pg_constraint",
        "    WHERE conrelid = " + rel + "::regclass AND conname = " + quoteLiteral(tempName),
        "  ) AND NOT EXISTS (",
        "    " + replacementQuery.replaceAll("\n", "\n    "),
        "  ) THEN",
        "    RAISE EXCEPTION " + quoteLiteral("TEMP_FK_NAME_COLLISION: " + tempName) + ";",
        "  END IF;",
      ].join("\n");
      return [oldFkCheck, tempFkCheck, orphanCheck(fk)];
    }),
  ];

  const expandBatches = tableGroups.map((group) => {
    const statements = group.foreignKeys.map((fk) => {
      const index = records.indexOf(fk);
      const rel = relation(fk);
      const newName = temporaryName(fk, index);
      const column = quoteIdentifier(fk.source_columns[0], "source_column");
      const newNameSql = quoteIdentifier(newName, "temporary_constraint_name");
      const exactReplacement = replacementConstraintQuery(fk, index);
      const addSql = [
        "ALTER TABLE " + rel,
        "ADD CONSTRAINT " + newNameSql,
        "FOREIGN KEY (" + column + ")",
        'REFERENCES private.app_users ("id")',
        "MATCH SIMPLE",
        "ON UPDATE NO ACTION",
        "ON DELETE " + fk.on_delete,
        "NOT DEFERRABLE INITIALLY IMMEDIATE",
        "NOT VALID",
      ].join(" ");
      return [
        "DO $$",
        "BEGIN",
        "  IF EXISTS (",
        "    SELECT 1 FROM pg_constraint WHERE conrelid = " + quoteLiteral(fk.source_schema + "." + fk.source_table) + "::regclass AND conname = " + quoteLiteral(newName),
        "  ) THEN",
        "    IF NOT EXISTS (",
        "      " + exactReplacement.replaceAll("\n", "\n      "),
        "    ) THEN",
        "      RAISE EXCEPTION " + quoteLiteral("REPLACEMENT_FK_SEMANTIC_DRIFT: " + newName) + ";",
        "    END IF;",
        "  ELSE",
        "    EXECUTE " + quoteLiteral(addSql) + ";",
        "  END IF;",
        "END",
        "$$;",
      ].join("\n");
    });
    return [
      "-- Bounded expansion batch: " + group.key,
      "BEGIN;",
      boundedTimeoutGuard(),
      statements.join("\n\n"),
      "COMMIT;",
    ].join("\n");
  });

  const validateBatches = tableGroups.map((group) => {
    const statements = group.foreignKeys.map((fk) => {
      const index = records.indexOf(fk);
      const rel = relation(fk);
      const newName = temporaryName(fk, index);
      const relLiteral = quoteLiteral(fk.source_schema + "." + fk.source_table);
      const nameLiteral = quoteLiteral(newName);
      const exactReplacement = replacementConstraintQuery(fk, index);
      const validatedReplacement = replacementConstraintQuery(fk, index, true);
      const validateSql = "ALTER TABLE " + rel + " VALIDATE CONSTRAINT " +
        quoteIdentifier(newName, "temporary_constraint_name");
      return [
        "DO $$",
        "BEGIN",
        "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = " + relLiteral + "::regclass AND conname = " + nameLiteral + ") THEN",
        "    RAISE EXCEPTION " + quoteLiteral("REPLACEMENT_FK_MISSING: " + newName) + ";",
        "  ELSIF NOT EXISTS (",
        "    " + exactReplacement.replaceAll("\n", "\n    "),
        "  ) THEN",
        "    RAISE EXCEPTION " + quoteLiteral("REPLACEMENT_FK_SEMANTIC_DRIFT: " + newName) + ";",
        "  ELSIF NOT EXISTS (",
        "    " + validatedReplacement.replaceAll("\n", "\n    "),
        "  ) THEN",
        "    EXECUTE " + quoteLiteral(validateSql) + ";",
        "  END IF;",
        "END",
        "$$;",
      ].join("\n");
    });
    return [
      "-- Bounded validation batch: " + group.key,
      "BEGIN;",
      boundedTimeoutGuard(),
      statements.join("\n\n"),
      "COMMIT;",
    ].join("\n");
  });

  const cutoverGuards = records.map((fk, index) => {
    const rel = quoteLiteral(fk.source_schema + "." + fk.source_table);
    const newName = temporaryName(fk, index);
    const validatedReplacement = replacementConstraintQuery(fk, index, true);
    return [
      "  IF NOT EXISTS (",
      "    " + validatedReplacement.replaceAll("\n", "\n    "),
      "  ) THEN",
      "    RAISE EXCEPTION " + quoteLiteral("REPLACEMENT_FK_NOT_VALIDATED_OR_SEMANTICS_CHANGED: " + newName) + ";",
      "  END IF;",
      "  IF NOT EXISTS (",
      "    SELECT 1 FROM pg_constraint",
      "    WHERE conrelid = " + rel + "::regclass",
      "      AND conname = " + quoteLiteral(fk.name),
      "      AND confrelid = 'auth.users'::regclass",
      "  ) THEN",
      "    RAISE EXCEPTION " + quoteLiteral("LEGACY_FK_MISSING: " + fk.name) + ";",
      "  END IF;",
    ].join("\n");
  });

  const cutoverStatements = records.flatMap((fk, index) => [
    "ALTER TABLE " + relation(fk) + " DROP CONSTRAINT " + quoteIdentifier(fk.name, "constraint_name") + ";",
    "ALTER TABLE " + relation(fk) + " RENAME CONSTRAINT " + quoteIdentifier(temporaryName(fk, index), "temporary_constraint_name") + " TO " + quoteIdentifier(fk.name, "constraint_name") + ";",
  ]);

  return {
    "01-preflight-expand.sql": header("full preflight + resumable bounded expansion") +
      boundedTimeoutGuard() + "\n\n" +
      "DO $\nBEGIN\n" + preflightChecks.join("\n\n") + "\nEND\n$;\n\n" +
      expandBatches.join("\n\n") + "\n",
    "02-validate.sql": header("resumable bounded replacement validation") +
      validateBatches.join("\n\n") + "\n",
    "03-cutover.sql": header("single atomic cutover after all validation batches succeed") +
      "BEGIN;\n" + boundedTimeoutGuard() + "\nDO $$\nBEGIN\n" +
      cutoverGuards.join("\n\n") + "\nEND\n$$;\n\n" +
      cutoverStatements.join("\n") + "\nCOMMIT;\n",
  };
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--catalog") args.catalog = argv[++i];
    else if (argv[i] === "--out-dir") args.outDir = argv[++i];
    else if (argv[i] === "--help") args.help = true;
    else throw new Error("Unknown argument: " + argv[i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.catalog || !args.outDir) {
    process.stdout.write(
      "Usage: node generate-app-users-fk-plan.mjs --catalog <json> --out-dir </absolute/outside/repo>\n" +
      "Generates three review-only SQL files. It does not connect to or execute SQL against any database.\n",
    );
    if (!args.help) process.exitCode = 2;
    return;
  }

  if (!path.isAbsolute(args.outDir)) {
    throw new Error("--out-dir must be an absolute path outside the Git repository");
  }
  const catalogPath = path.resolve(args.catalog);
  const outDir = path.resolve(args.outDir);
  const relativeToRepo = path.relative(repoRoot, outDir);
  const isInsideRepo = relativeToRepo === "" ||
    (!path.isAbsolute(relativeToRepo) && relativeToRepo !== ".." && !relativeToRepo.startsWith(".." + path.sep));
  if (isInsideRepo) {
    throw new Error("Output directory must be outside the Git repository");
  }

  const snapshot = JSON.parse(readFileSync(catalogPath, "utf8"));
  const plan = generatePlan(snapshot);
  mkdirSync(outDir, { recursive: true });
  for (const [filename, sql] of Object.entries(plan)) {
    writeFileSync(path.join(outDir, filename), sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write(
    "Generated " + Object.keys(plan).length + " review-only SQL files for " +
    validateCatalog(snapshot).length + " foreign keys in " + outDir + "\n" +
    "No database connection was opened and no SQL was executed.\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  });
}

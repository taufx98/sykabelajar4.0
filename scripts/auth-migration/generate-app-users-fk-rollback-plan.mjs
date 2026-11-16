#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateCatalog } from "./generate-app-users-fk-plan.mjs";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function qi(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error("Unsafe or invalid SQL identifier in " + label);
  }
  return '"' + value + '"';
}
function ql(value) {
  if (typeof value !== "string") throw new Error("Expected SQL string literal");
  return "'" + value.replaceAll("'", "''") + "'";
}
function rel(fk) {
  return qi(fk.source_schema, "source_schema") + "." + qi(fk.source_table, "source_table");
}
function tempName(fk, index) {
  const key = [fk.source_schema, fk.source_table, fk.name].join(".");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 10);
  return "ba_auth_rollback_fk_" + String(index + 1).padStart(3, "0") + "_" + digest;
}
function deleteCode(action) {
  return { CASCADE: "c", "SET NULL": "n", "NO ACTION": "a", RESTRICT: "r", "SET DEFAULT": "d" }[action];
}
function fkQuery(fk, index, target, requireValidated = false) {
  const relation = ql(fk.source_schema + "." + fk.source_table);
  const name = ql(target === "auth.users" ? tempName(fk, index) : fk.name);
  const sourceColumn = ql(fk.source_columns[0]);
  const targetRegclass = ql(target + "");
  return [
    "SELECT 1 FROM pg_constraint AS c",
    "WHERE c.conrelid = " + relation + "::regclass",
    "  AND c.conname = " + name,
    "  AND c.contype = 'f'",
    "  AND c.confrelid = " + targetRegclass + "::regclass",
    "  AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = " + relation + "::regclass AND attname = " + sourceColumn + ")]::smallint[]",
    "  AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = " + targetRegclass + "::regclass AND attname = 'id')]::smallint[]",
    "  AND c.confmatchtype = 's'",
    "  AND c.confupdtype = 'a'",
    "  AND c.confdeltype = '" + deleteCode(fk.on_delete) + "'",
    "  AND NOT c.condeferrable",
    "  AND NOT c.condeferred" + (requireValidated ? "\n  AND c.convalidated" : ""),
  ].join("\n");
}
function boundedGuard() {
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
function orphanGuard(fk) {
  const column = qi(fk.source_columns[0], "source_column");
  return [
    "  IF EXISTS (",
    "    SELECT 1 FROM " + rel(fk) + " AS child",
    "    LEFT JOIN auth.users AS legacy_user ON legacy_user.id = child." + column,
    "    WHERE child." + column + " IS NOT NULL AND legacy_user.id IS NULL",
    "  ) THEN",
    "    RAISE EXCEPTION " + ql("ROLLBACK_AUTH_USER_ORPHANS: " + fk.source_schema + "." + fk.source_table + "." + fk.source_columns[0]) + ";",
    "  END IF;",
  ].join("\n");
}
function groups(records) {
  const map = new Map();
  for (const fk of records) {
    const key = fk.source_schema + "." + fk.source_table;
    map.set(key, [...(map.get(key) ?? []), fk]);
  }
  return [...map.entries()].map(([key, foreignKeys]) => ({ key, foreignKeys }));
}

/**
 * This generator reverses only the 69 application FK targets, and only while
 * every identity UUID still exists in auth.users. It must fail closed once a
 * Better Auth-only identity has been provisioned: never create shadow Auth rows.
 * It does not drop private.app_users or restore functions/triggers/issuer policy.
 */
export function generateRollbackPlan(snapshot) {
  const records = validateCatalog(snapshot);
  const tableGroups = groups(records);
  const stamp = snapshot.generated_at ?? "unknown";
  const header = (phase) => [
    "-- GENERATED FK ROLLBACK REVIEW PLAN ONLY — DO NOT APPLY WITHOUT OWNER APPROVAL.",
    "-- Production catalog snapshot: " + stamp,
    "-- Reverse target: private.app_users(id) -> auth.users(id)",
    "-- This reverses FK targets only; it does not delete Better Auth identities,",
    "-- drop private.app_users, restore functions/triggers, or remove issuer guards.",
    "-- HARD STOP: every private.app_users.id must still exist in auth.users.",
    "-- Never create shadow auth.users rows or copy credentials to make rollback pass.",
    "-- REQUIRED: finite lock_timeout and statement_timeout chosen from workload data.",
    "-- Expand/validate are bounded per-source-table commits; cutover is globally atomic.",
    "",
  ].join("\n");

  const preflight = [
    "  IF to_regclass('auth.users') IS NULL OR to_regclass('private.app_users') IS NULL THEN",
    "    RAISE EXCEPTION 'ROLLBACK_IDENTITY_TABLE_MISSING';",
    "  END IF;",
    "  IF EXISTS (",
    "    SELECT 1 FROM private.app_users AS app_user",
    "    LEFT JOIN auth.users AS legacy_user ON legacy_user.id = app_user.id",
    "    WHERE legacy_user.id IS NULL",
    "  ) THEN",
    "    RAISE EXCEPTION 'ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS';",
    "  END IF;",
    ...records.flatMap((fk, index) => {
      const currentFk = fkQuery(fk, index, "private.app_users", true);
      const temp = tempName(fk, index);
      return [
        [
          "  IF NOT EXISTS (",
          "    " + currentFk.replaceAll("\n", "\n    "),
          "  ) THEN",
          "    RAISE EXCEPTION " + ql("ROLLBACK_CURRENT_APP_USERS_FK_DRIFT: " + fk.name) + ";",
          "  END IF;",
        ].join("\n"),
        [
          "  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = " +
            ql(fk.source_schema + "." + fk.source_table) + "::regclass AND conname = " + ql(temp) + ") THEN",
          "    RAISE EXCEPTION " + ql("ROLLBACK_TEMP_FK_NAME_COLLISION: " + temp) + ";",
          "  END IF;",
        ].join("\n"),
        orphanGuard(fk),
      ];
    }),
  ];

  const expand = tableGroups.map((group) => {
    const statements = group.foreignKeys.map((fk) => {
      const index = records.indexOf(fk);
      const name = tempName(fk, index);
      const addSql = [
        "ALTER TABLE " + rel(fk),
        "ADD CONSTRAINT " + qi(name, "temporary_constraint_name"),
        "FOREIGN KEY (" + qi(fk.source_columns[0], "source_column") + ")",
        'REFERENCES auth.users ("id")',
        "MATCH SIMPLE",
        "ON UPDATE NO ACTION",
        "ON DELETE " + fk.on_delete,
        "NOT DEFERRABLE INITIALLY IMMEDIATE",
        "NOT VALID",
      ].join(" ");
      const exact = fkQuery(fk, index, "auth.users");
      return [
        "DO $$",
        "BEGIN",
        "  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = " +
          ql(fk.source_schema + "." + fk.source_table) + "::regclass AND conname = " + ql(name) + ") THEN",
        "    IF NOT EXISTS (" + exact.replaceAll("\n", "\n      ") + ") THEN",
        "      RAISE EXCEPTION " + ql("ROLLBACK_REPLACEMENT_FK_SEMANTIC_DRIFT: " + name) + ";",
        "    END IF;",
        "  ELSE",
        "    EXECUTE " + ql(addSql) + ";",
        "  END IF;",
        "END",
        "$$;",
      ].join("\n");
    });
    return [
      "-- Bounded rollback expansion batch: " + group.key,
      "BEGIN;",
      boundedGuard(),
      statements.join("\n\n"),
      "COMMIT;",
    ].join("\n");
  });

  const validate = tableGroups.map((group) => {
    const statements = group.foreignKeys.map((fk) => {
      const index = records.indexOf(fk);
      const name = tempName(fk, index);
      const relation = rel(fk);
      const exists = "SELECT 1 FROM pg_constraint WHERE conrelid = " +
        ql(fk.source_schema + "." + fk.source_table) + "::regclass AND conname = " + ql(name);
      const exact = fkQuery(fk, index, "auth.users");
      const exactValidated = fkQuery(fk, index, "auth.users", true);
      const validateSql = "ALTER TABLE " + relation + " VALIDATE CONSTRAINT " + qi(name, "temporary_constraint_name");
      return [
        "DO $$",
        "BEGIN",
        "  IF NOT EXISTS (" + exists + ") THEN",
        "    RAISE EXCEPTION " + ql("ROLLBACK_REPLACEMENT_FK_MISSING: " + name) + ";",
        "  ELSIF NOT EXISTS (" + exact.replaceAll("\n", "\n    ") + ") THEN",
        "    RAISE EXCEPTION " + ql("ROLLBACK_REPLACEMENT_FK_SEMANTIC_DRIFT: " + name) + ";",
        "  ELSIF NOT EXISTS (" + exactValidated.replaceAll("\n", "\n    ") + ") THEN",
        "    EXECUTE " + ql(validateSql) + ";",
        "  END IF;",
        "END",
        "$$;",
      ].join("\n");
    });
    return [
      "-- Bounded rollback validation batch: " + group.key,
      "BEGIN;",
      boundedGuard(),
      statements.join("\n\n"),
      "COMMIT;",
    ].join("\n");
  });

  const cutoverGuards = records.map((fk, index) => {
    const replacement = fkQuery(fk, index, "auth.users", true);
    const current = fkQuery(fk, index, "private.app_users", true);
    return [
      "  IF NOT EXISTS (" + replacement.replaceAll("\n", "\n    ") + ") THEN",
      "    RAISE EXCEPTION " + ql("ROLLBACK_FK_NOT_VALIDATED_OR_SEMANTICS_CHANGED: " + tempName(fk, index)) + ";",
      "  END IF;",
      "  IF NOT EXISTS (" + current.replaceAll("\n", "\n    ") + ") THEN",
      "    RAISE EXCEPTION " + ql("ROLLBACK_CURRENT_FK_MISSING_OR_SEMANTICS_CHANGED: " + fk.name) + ";",
      "  END IF;",
    ].join("\n");
  });
  const cutoverIdentityGuard = [
    "  IF EXISTS (",
    "    SELECT 1 FROM private.app_users AS app_user",
    "    LEFT JOIN auth.users AS legacy_user ON legacy_user.id = app_user.id",
    "    WHERE legacy_user.id IS NULL",
    "  ) THEN",
    "    RAISE EXCEPTION 'ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS';",
    "  END IF;",
  ].join("\n");
  const statements = records.flatMap((fk, index) => [
    "ALTER TABLE " + rel(fk) + " DROP CONSTRAINT " + qi(fk.name, "current_constraint_name") + ";",
    "ALTER TABLE " + rel(fk) + " RENAME CONSTRAINT " + qi(tempName(fk, index), "temporary_constraint_name") +
      " TO " + qi(fk.name, "original_constraint_name") + ";",
  ]);

  return {
    "01-preflight-expand-auth-rollback.sql": header("preflight + bounded reverse expansion") +
      boundedGuard() + "\n\nDO $$\nBEGIN\n" + preflight.join("\n\n") + "\nEND\n$$;\n\n" +
      expand.join("\n\n") + "\n",
    "02-validate-auth-rollback.sql": header("bounded reverse validation") + validate.join("\n\n") + "\n",
    "03-cutover-auth-rollback.sql": header("single atomic reverse FK cutover") +
      "BEGIN;\n" + boundedGuard() + "\nDO $$\nBEGIN\n" +
      cutoverIdentityGuard + "\n\n" + cutoverGuards.join("\n\n") +
      "\nEND\n$$;\n\n" + statements.join("\n") + "\nCOMMIT;\n",
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
      "Usage: node generate-app-users-fk-rollback-plan.mjs --catalog <json> --out-dir </absolute/outside/repo>\n" +
      "Generates three review-only reverse FK files; it never connects to or executes SQL.\n",
    );
    if (!args.help) process.exitCode = 2;
    return;
  }
  if (!path.isAbsolute(args.outDir)) throw new Error("--out-dir must be an absolute path");
  const outDir = path.resolve(args.outDir);
  const relative = path.relative(repoRoot, outDir);
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep))) {
    throw new Error("Output directory must be outside the Git repository");
  }
  const snapshot = JSON.parse(readFileSync(path.resolve(args.catalog), "utf8"));
  const plan = generateRollbackPlan(snapshot);
  mkdirSync(outDir, { recursive: true });
  for (const [filename, sql] of Object.entries(plan)) {
    writeFileSync(path.join(outDir, filename), sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write("Generated " + Object.keys(plan).length + " review-only FK rollback SQL files for " +
    validateCatalog(snapshot).length + " foreign keys in " + outDir + "\n" +
    "No database connection was opened and no SQL was executed.\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  });
}

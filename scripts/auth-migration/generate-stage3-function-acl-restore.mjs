import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const FUNCTIONS = new Map([
  ["private.apply_referral_qualification", "private.apply_referral_qualification(uuid,text,timestamptz)"],
  ["private.capture_signup_referral", "private.capture_signup_referral()"],
  ["private.process_referral_email_confirmation", "private.process_referral_email_confirmation()"],
  ["public.create_organizer", "public.create_organizer(text,text)"],
  ["public.get_my_referrals", "public.get_my_referrals()"],
  ["public.get_my_referrals_v2", "public.get_my_referrals_v2()"],
  ["public.get_my_verified_referrals", "public.get_my_verified_referrals()"],
  ["public.handle_new_auth_user", "public.handle_new_auth_user()"],
  ["public.register_for_competition", "public.register_for_competition(uuid,text,uuid,text,boolean,text,text,text)"],
  ["public.verify_pending_referrals", "public.verify_pending_referrals()"],
]);
const ALLOWED_GRANTEES = new Set(["PUBLIC", "anon", "authenticated", "service_role", "postgres"]);

function sqlIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error("Unsafe SQL role/schema/function identifier in ACL metadata.");
  }
  return '"' + value + '"';
}

function renderFunctionAclRestore(metadata) {
  if (!Array.isArray(metadata?.auth_dependent_functions)) {
    throw new Error("Auth-dependent function metadata is missing.");
  }

  const records = new Map();
  for (const row of metadata.auth_dependent_functions) {
    const key = row.schema_name + "." + row.function_name;
    if (!FUNCTIONS.has(key)) continue;
    if (records.has(key)) throw new Error("Duplicate Auth function metadata: " + key);
    if (!Array.isArray(row.function_acl_entries)) {
      throw new Error("Structured function ACL metadata is missing for " + key + ".");
    }
    records.set(key, row);
  }

  if (records.size !== FUNCTIONS.size) {
    throw new Error("Expected ACL metadata for all 10 reviewed Auth-dependent functions; found " + records.size + ".");
  }

  const statements = [
    "-- Generated from production catalog ACL metadata; local disposable restore only.",
    "-- This file is never executed against the production database.",
    "BEGIN;",
  ];

  for (const [key, signature] of FUNCTIONS) {
    const row = records.get(key);
    const expectedSignature = signature;
    const aclEntries = row.function_acl_entries;
    const seen = new Set();

    for (const entry of aclEntries) {
      if (!ALLOWED_GRANTEES.has(entry.grantee)) {
        throw new Error("Unsupported function ACL grantee for " + key + ": " + entry.grantee);
      }
      if (entry.privilege_type !== "EXECUTE") {
        throw new Error("Unsupported function ACL privilege for " + key + ": " + entry.privilege_type);
      }
      if (entry.grantor !== "postgres") {
        throw new Error("Unexpected function ACL grantor for " + key + ": " + entry.grantor);
      }
      if (seen.has(entry.grantee)) {
        throw new Error("Duplicate function ACL grantee for " + key + ": " + entry.grantee);
      }
      seen.add(entry.grantee);
      if (typeof entry.is_grantable !== "boolean") {
        throw new Error("Invalid function ACL grant option for " + key + ".");
      }
    }

    statements.push(
      "REVOKE ALL PRIVILEGES ON FUNCTION " + expectedSignature +
      " FROM PUBLIC, anon, authenticated, service_role;"
    );

    for (const entry of aclEntries) {
      if (entry.grantee === "postgres") continue; // function owner already has full rights
      const grantee = entry.grantee === "PUBLIC" ? "PUBLIC" : sqlIdentifier(entry.grantee);
      statements.push(
        "GRANT EXECUTE ON FUNCTION " + expectedSignature +
        " TO " + grantee +
        (entry.is_grantable ? " WITH GRANT OPTION" : "") + ";"
      );
    }
  }

  statements.push("COMMIT;");
  return statements.join("\n") + "\n";
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--metadata") args.metadata = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else throw new Error("Unknown argument: " + argv[i]);
  }
  if (!args.metadata || !args.out) {
    throw new Error("Usage: node generate-stage3-function-acl-restore.mjs --metadata <metadata.json> --out <local-only.sql>");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(args.metadata, "utf8"));
  const sql = renderFunctionAclRestore(metadata);
  writeFileSync(args.out, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(
    "Generated local-only ACL restoration SQL for 10 Auth-dependent functions. No database connection was opened.\n"
  );
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  }
}

export { renderFunctionAclRestore };

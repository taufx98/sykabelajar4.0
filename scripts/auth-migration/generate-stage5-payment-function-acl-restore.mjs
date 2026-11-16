import { readFileSync, writeFileSync } from "node:fs";

const FUNCTION = "public.process_payment_gateway_success(uuid,text,uuid)";
const EXPECTED_IDENTITY = "p_order_id uuid, p_provider text, p_payment_intent_id uuid";

function renderPaymentFunctionAclRestore(metadata) {
  const row = metadata?.stage5_payment_fulfillment_function;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Stage 5 payment fulfillment function metadata is missing.");
  }
  if (row.schema_name !== "public" ||
      row.function_name !== "process_payment_gateway_success" ||
      row.identity_arguments !== EXPECTED_IDENTITY) {
    throw new Error("Stage 5 payment fulfillment function signature changed.");
  }
  if (row.security_definer !== true ||
      !Array.isArray(row.function_config) ||
      !row.function_config.includes("search_path=public, private, pg_catalog")) {
    throw new Error("Stage 5 payment fulfillment SECURITY DEFINER/search_path metadata changed.");
  }
  if (row.anon_execute !== false ||
      row.authenticated_execute !== false ||
      row.service_role_execute !== true ||
      row.postgres_execute !== true) {
    throw new Error("Production payment fulfillment effective EXECUTE ACL is not service_role-only.");
  }
  if (!Array.isArray(row.function_acl_entries)) {
    throw new Error("Structured Stage 5 payment function ACL metadata is missing.");
  }

  const entries = row.function_acl_entries;
  const seen = new Set();
  for (const entry of entries) {
    if (!["postgres", "service_role"].includes(entry.grantee)) {
      throw new Error("Unexpected Stage 5 payment function ACL grantee: " + entry.grantee);
    }
    if (entry.privilege_type !== "EXECUTE") {
      throw new Error("Unexpected Stage 5 payment function ACL privilege: " + entry.privilege_type);
    }
    if (entry.grantor !== "postgres") {
      throw new Error("Unexpected Stage 5 payment function ACL grantor: " + entry.grantor);
    }
    if (seen.has(entry.grantee)) {
      throw new Error("Duplicate Stage 5 payment function ACL grantee: " + entry.grantee);
    }
    seen.add(entry.grantee);
    if (typeof entry.is_grantable !== "boolean") {
      throw new Error("Invalid Stage 5 payment function ACL grant option.");
    }
  }
  if (!seen.has("postgres") || !seen.has("service_role") || seen.size !== 2) {
    throw new Error("Production payment function ACL must contain only its postgres owner and service_role.");
  }
  if (entries.find(entry => entry.grantee === "service_role").is_grantable) {
    throw new Error("Production service_role EXECUTE must not be grantable onward.");
  }

  return [
    "-- Generated from read-only Production catalog ACL metadata.",
    "-- Disposable database only; never execute this SQL against Production.",
    "BEGIN;",
    "REVOKE ALL PRIVILEGES ON FUNCTION " + FUNCTION + " FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION " + FUNCTION + " TO service_role;",
    "DO $verify_stage5_payment_acl$",
    "BEGIN",
    "  IF NOT has_function_privilege('service_role', '" + FUNCTION + "', 'EXECUTE')",
    "     OR has_function_privilege('anon', '" + FUNCTION + "', 'EXECUTE')",
    "     OR has_function_privilege('authenticated', '" + FUNCTION + "', 'EXECUTE')",
    "     OR NOT has_function_privilege('postgres', '" + FUNCTION + "', 'EXECUTE') THEN",
    "    RAISE EXCEPTION 'STAGE5_PAYMENT_ACL_RESTORE_POSTCONDITION_FAILED';",
    "  END IF;",
    "END;",
    "$verify_stage5_payment_acl$;",
    "COMMIT;",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--metadata") args.metadata = argv[++index];
    else if (argv[index] === "--out") args.out = argv[++index];
    else throw new Error("Unknown argument: " + argv[index]);
  }
  if (!args.metadata || !args.out) {
    throw new Error("Usage: node generate-stage5-payment-function-acl-restore.mjs --metadata <metadata.json> --out <local-only.sql>");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(args.metadata, "utf8"));
  const sql = renderPaymentFunctionAclRestore(metadata);
  writeFileSync(args.out, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write("Generated Stage 5 payment function ACL restoration SQL for the disposable database only. No database connection was opened.\n");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error?.message ?? error) + "\n");
    process.exitCode = 1;
  }
}

export { renderPaymentFunctionAclRestore };

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
  ["public.archive_my_order_history", "public.archive_my_order_history(uuid)"],
  ["public.bulk_import_roster_students", "public.bulk_import_roster_students(uuid,jsonb)"],
  ["public.cancel_my_pending_order", "public.cancel_my_pending_order(uuid)"],
  ["public.claim_and_complete_daily_task", "public.claim_and_complete_daily_task(uuid)"],
  ["public.claim_daily_checkin", "public.claim_daily_checkin(date,integer)"],
  ["public.claim_daily_task", "public.claim_daily_task(uuid)"],
  ["public.claim_organizer_voucher", "public.claim_organizer_voucher(uuid)"],
  ["public.claim_rpc_recovery", "public.claim_rpc_recovery(text)"],
  ["public.complete_daily_task", "public.complete_daily_task(uuid)"],
  ["public.create_ad_banner_payment_order", "public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)"],
  ["private.provision_collective_registration", "private.provision_collective_registration(uuid)"],
  ["public.provision_collective_registration", "public.provision_collective_registration(uuid)"],
  ["public.regenerate_collective_participant_password", "public.regenerate_collective_participant_password(uuid)"],
  ["public.get_canonical_competition_result", "public.get_canonical_competition_result(uuid)"],
  ["public.create_follow_request", "public.create_follow_request(uuid)"],
  ["public.get_my_canonical_competition_result", "public.get_my_canonical_competition_result(uuid)"],
  ["public.get_my_canonical_participant", "public.get_my_canonical_participant(uuid)"],
  ["public.get_my_learning_insights", "public.get_my_learning_insights()"],
  ["public.get_my_referral_tier_awards", "public.get_my_referral_tier_awards()"],
  ["public.list_my_canonical_certificates", "public.list_my_canonical_certificates()"],
  ["public.list_my_claimed_collective_history", "public.list_my_claimed_collective_history()"],
  ["public.list_my_competition_dashboard", "public.list_my_competition_dashboard()"],
  ["public.list_my_participant_core", "public.list_my_participant_core()"],
  ["public.list_my_shop_vouchers", "public.list_my_shop_vouchers()"],
  ["public.mark_my_shop_vouchers_seen", "public.mark_my_shop_vouchers_seen()"],
  ["public.remove_follow", "public.remove_follow(uuid)"],
  ["public.respond_follow_request", "public.respond_follow_request(uuid,boolean)"],
  ["public.save_my_commerce_product_review", "public.save_my_commerce_product_review(uuid,smallint,text)"],
]);
const ALLOWED_GRANTEES = new Set(["PUBLIC", "anon", "authenticated", "service_role", "postgres"]);

function sqlIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error("Unsafe SQL role/schema/function identifier in ACL metadata.");
  }
  return '"' + value + '"';
}

function renderFunctionAclRestore(metadata) {
  if (!Array.isArray(metadata?.auth_dependent_functions) ||
      !Array.isArray(metadata?.user_scoped_issuer_functions) ||
      !Array.isArray(metadata?.personal_rpc_issuer_functions)) {
    throw new Error("Stage 3 function ACL metadata groups are missing.");
  }

  const records = new Map();
  const functionRows = [
    ...metadata.auth_dependent_functions,
    ...metadata.user_scoped_issuer_functions,
    ...metadata.personal_rpc_issuer_functions,
  ];
  for (const row of functionRows) {
    const key = row.schema_name + "." + row.function_name;
    if (!FUNCTIONS.has(key)) continue;
    if (records.has(key)) throw new Error("Duplicate Auth function metadata: " + key);
    if (!Array.isArray(row.function_acl_entries)) {
      throw new Error("Structured function ACL metadata is missing for " + key + ".");
    }
    records.set(key, row);
  }

  if (records.size !== FUNCTIONS.size) {
    throw new Error("Expected ACL metadata for all 38 reviewed auth identity and participant-result functions; found " + records.size + ".");
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
    "Generated local-only ACL restoration SQL for all 38 auth identity and participant-result functions. No database connection was opened.\n"
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

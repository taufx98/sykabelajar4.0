import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const draft = read("docs/security/AUTH-STAGE-7-OWNER-SCOPED-PAYMENT-ISSUER-GUARDS-DRAFT.sql");
const regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
const stage3UserRpcDraft = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const postStage3Runtime = read("scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.regression.sql");
const postStage3Draft = read("docs/security/AUTH-STAGE-7-POST-STAGE3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const shopMigration = read("supabase/migrations/20261103074001_shop_vouchers_and_carousel_banners.sql");
const adBannerPaymentMigration = read("supabase/migrations/20261029100000_unify_ad_banner_payments.sql");
const paymentGatewaySettingsMigration = read("supabase/migrations/20261029090000_unified_payment_gateway_settings.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");
const triage = JSON.parse(read("docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json"));

const targets = [
  {
    signature: "create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)",
    md5: "fa5e3bb6726bdf8d8b6768871c71ef97",
  },
  {
    signature: "create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)",
    md5: "7fae7e641d7bed2a24bacaf3724139e7",
  },
  {
    signature: "create_collective_certificate_order(uuid)",
    md5: "0041c711a1e602b6d15dbd390d4669a3",
    postStage3Md5: "5c5843aca76cc5431565c848c6d35a7c",
  },
];

for (const target of targets) {
  const entry = triage.functions.find((fn) => fn.signature === target.signature);
  assert.ok(entry, "Missing exact 202-function inventory entry: " + target.signature);
  assert.equal(entry.sourceMd5, target.md5, "Production source fingerprint changed: " + target.signature);
  assert.equal(entry.owner, "postgres");
  assert.equal(entry.searchPathConfig[0], "search_path=public, private");
  assert.equal(entry.execute.anon, false);
  assert.equal(entry.execute.authenticated, true);
  assert.equal(entry.execute.serviceRole, true);
  assert.ok(draft.includes(target.postStage3Md5 ?? target.md5),
    "Disposable preflight must pin the exact post-Stage-3 source fingerprint: " + target.signature);
  if (target.postStage3Md5) {
    const functionName = target.signature.slice(0, target.signature.indexOf("("));
    const start = stage3UserRpcDraft.toLowerCase().indexOf("create or replace function public." + functionName.toLowerCase() + "(");
    const bodyStart = stage3UserRpcDraft.indexOf("AS $function$", start);
    const bodyEnd = stage3UserRpcDraft.indexOf("$function$;", bodyStart);
    assert.ok(start >= 0 && bodyStart >= 0 && bodyEnd > bodyStart,
      "Stage 3 replacement body must be present: " + target.signature);
    const body = stage3UserRpcDraft.slice(bodyStart + "AS $function$".length, bodyEnd);
    assert.equal(createHash("md5").update(body, "utf8").digest("hex"), target.postStage3Md5,
      "Stage 3 replacement fingerprint drifted: " + target.signature);
  }
  assert.ok(draft.includes(target.signature), "Draft must preflight exact signature: " + target.signature);
}

assert.match(draft, /CREATE TEMP TABLE stage7_owner_scoped_payment_rpc_before/);
assert.match(draft, /pg_get_functiondef/);
assert.match(draft, /md5\(p\.prosrc\)/);
assert.match(draft, /private\.current_user_is_better_auth\(\)/);
assert.match(draft, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(draft, /v_price := public\.get_collective_certificate_price\(\)/);
assert.match(draft, /STAGE7_PAYMENT_RPC_METADATA_OR_ACL_MUTATED/);
assert.match(draft, /STAGE7_PAYMENT_RPC_EXECUTE_BOUNDARY_MUTATED/);
assert.doesNotMatch(draft, /ALTER TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE public[.]/i,
  "This RPC draft must not mutate tables or application data.");
const aclStatements = draft.match(/^(?:REVOKE ALL PRIVILEGES ON FUNCTION|GRANT EXECUTE ON FUNCTION).*$/gm) ?? [];
assert.equal(aclStatements.length, 6, "Only the three reviewed function ACLs may be reconstructed.");
assert.equal(aclStatements.filter((line) => line.startsWith("REVOKE ALL PRIVILEGES ON FUNCTION")).length, 3);
assert.equal(aclStatements.filter((line) => line.startsWith("GRANT EXECUTE ON FUNCTION")).length, 3);
assert.match(draft, /IF v_count <> 3 THEN/);
assert.match(draft, /STAGE7_CERTIFICATE_ORDER_OWNER_BEFORE_GATEWAY_POSTCONDITION_FAILED/);
assert.match(draft, /STAGE7_CERTIFICATE_PRICE_OR_GATEWAY_READ_PRECEDES_OWNER_GUARD/);
assert.match(draft, /STAGE7_CERTIFICATE_GATEWAY_OWNER_PATCH_POSTCONDITION_FAILED/);
assert.ok(draft.includes("FROM PUBLIC, anon, authenticated, service_role;"));
assert.match(draft, /TO authenticated, service_role;/);
assert.match(draft, /STAGE7_PAYMENT_RPC_ACL_RESTORE_POSTCONDITION_FAILED/);
assert.match(draft, /STAGE7_PAYMENT_RPC_ACL_ENTRY_DRIFT/);

for (const marker of [
  "STAGE7_CERTIFICATE_OWNER_POSITIVE_FAILED",
  "STAGE7_CERTIFICATE_FOREIGN_OWNER_NOT_DENIED",
  "STAGE7_CERTIFICATE_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_CERTIFICATE_GATEWAY_FOREIGN_OWNER_NOT_DENIED",
  "STAGE7_CERTIFICATE_GATEWAY_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_ORGANIZER_OWNER_SCOPE_FAILED",
  "STAGE7_ORGANIZER_FOREIGN_MEMBER_NOT_DENIED",
  "STAGE7_ORGANIZER_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_ORGANIZER_ADMIN_OVERRIDE_FAILED",
]) {
  assert.ok(regression.includes(marker), "Missing disposable runtime assertion: " + marker);
}

for (const marker of [
  "STAGE7_VOUCHER_OWNER_A_CANNOT_READ_OWN_VOUCHER",
  "STAGE7_VOUCHER_OWNER_A_READ_FOREIGN_VOUCHER",
  "STAGE7_VOUCHER_OWNER_A_MARK_SEEN_CROSSED_BOUNDARY",
  "STAGE7_VOUCHER_OWNER_B_CANNOT_READ_OWN_VOUCHER",
  "STAGE7_VOUCHER_OWNER_B_READ_FOREIGN_VOUCHER",
  "STAGE7_VOUCHER_OWNER_B_MARK_SEEN_CROSSED_BOUNDARY",
  "STAGE7_AD_BANNER_OWNER_A_FOREIGN_REQUEST_NOT_DENIED",
  "STAGE7_AD_BANNER_OWNER_A_OWN_REQUEST_SCOPE_FAILED",
  "STAGE7_AD_BANNER_OWNER_B_FOREIGN_REQUEST_NOT_DENIED",
  "STAGE7_AD_BANNER_OWNER_B_OWN_REQUEST_SCOPE_FAILED",
  "STAGE7_AD_BANNER_OWNER_A_ORDER_OWNER_MISMATCH",
  "STAGE7_AD_BANNER_OWNER_B_ORDER_OWNER_MISMATCH",
  "STAGE7_PAYMENT_GATEWAY_GLOBAL_METHOD_MISSING",
  "STAGE7_PAYMENT_GATEWAY_STATE_FIXTURE_MISSING",
  "STAGE7_VOUCHER_NON_ADMIN_ADMIN_RPC_NOT_DENIED",
  "STAGE7_VOUCHER_NON_ADMIN_SAVE_DEFINITION_NOT_DENIED",
  "STAGE7_VOUCHER_NON_ADMIN_ISSUE_NOT_DENIED",
  "STAGE7_VOUCHER_NON_ADMIN_LIST_ISSUED_NOT_DENIED",
  "STAGE7_VOUCHER_CALCULATOR_PRIVATE_EXECUTE_OVERBROAD",
]) {
  assert.ok(postStage3Runtime.includes(marker), "Missing rollback-only payment/voucher owner test: " + marker);
}
assert.match(postStage3Runtime, /stage7_payment_and_voucher_owner_runtime/);
assert.match(postStage3Runtime, /INSERT INTO public\.organizer_payment_methods/);
assert.match(postStage3Runtime, /STAGE7 disposable global gateway/);
assert.match(postStage3Runtime, /'global_gateway', true/);
assert.match(postStage3Runtime, /STAGE7_PAYMENT_GATEWAY_GLOBAL_METHOD_MISSING/);
assert.match(postStage3Runtime, /INSERT INTO public\.payment_gateway_configs/);
assert.match(postStage3Runtime, /STAGE7_DISPOSABLE_ONLY/);
assert.match(postStage3Runtime, /ROLLBACK;/);
assert.match(shopMigration, /where uv\.user_id=auth\.uid\(\)/i);
assert.match(shopMigration, /where user_id=auth\.uid\(\) and viewed_at is null/i);
assert.match(shopMigration, /if not private\.current_user_is_admin\(\) then raise exception 'ADMIN_REQUIRED'/i);
assert.match(shopMigration, /v_effects := private\.calculate_shop_voucher_effects\(\s*auth\.uid\(\)/i);
assert.match(shopMigration, /where uv\.id=any\(v_one_time_ids\) and uv\.user_id=auth\.uid\(\)/i);
assert.match(shopMigration, /revoke all on function private\.calculate_shop_voucher_effects\(uuid,uuid,integer,numeric,numeric,uuid\[\]\) from public,anon,authenticated/i);
assert.match(adBannerPaymentMigration, /where id=p_request_id and user_id=v_uid/i);
assert.match(adBannerPaymentMigration, /raise exception 'AD_BANNER_REQUEST_NOT_FOUND'/i);
assert.match(paymentGatewaySettingsMigration, /alter table public\.payment_gateway_configs enable row level security/i);
assert.match(paymentGatewaySettingsMigration, /revoke all on table public\.payment_gateway_configs from public, anon, authenticated/i);
assert.match(paymentGatewaySettingsMigration, /grant all on table public\.payment_gateway_configs to service_role/i);
assert.match(paymentGatewaySettingsMigration, /alter table public\.payment_gateway_state enable row level security/i);
assert.match(paymentGatewaySettingsMigration, /revoke all on table public\.payment_gateway_state from public, anon, authenticated/i);
assert.match(paymentGatewaySettingsMigration, /grant all on table public\.payment_gateway_state to service_role/i);
assert.match(postStage3Draft, /create_ad_banner_payment_order\(/i);

assert.ok(workflow.includes("docs/security/AUTH-STAGE-7-OWNER-SCOPED-PAYMENT-ISSUER-GUARDS-DRAFT.sql"));
assert.ok(workflow.includes("scripts/auth-migration/stage7-owner-scoped-payment-issuer-guards.contract.test.mjs"));
assert.match(workflow, /Apply Stage 7 owner-scoped payment issuer guards to disposable restore only/);
assert.match(workflow, /Run Stage 3 trusted-issuer RLS acceptance on disposable restore/);
assert.match(workflow, /--file=\/baseline\/stage7-owner-scoped-payment-issuer-guards\.sql/);
assert.match(workflow, /echo "- Added issuer-first Better Auth checks to two owner-scoped checkout SECURITY DEFINER RPCs; no Production writes"/);

console.log("Stage 7 owner-scoped payment issuer guard contract passed: exact Production fingerprints, reconstructed exact disposable ACL, preserved function metadata, and rollback-only issuer/owner tests.");

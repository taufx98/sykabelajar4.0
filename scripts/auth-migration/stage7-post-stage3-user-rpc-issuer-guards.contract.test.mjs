import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const draft = read("docs/security/AUTH-STAGE-7-POST-STAGE3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const runtime = read("scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");
const prWorkflow = read(".github/workflows/auth-schema-pr-contracts.yml");

const targets = [
  { signature: "create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)", md5: "8efe8ac377bf4eb71698eee52c61d03c", searchPath: "search_path=public, private, pg_catalog" },
  { signature: "create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)", md5: "55e3959c23dfc492155807f230ed16e4", searchPath: "search_path=\"\"" },
  { signature: "create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])", md5: "ed717139d1d9ec7053e25064b928bdf8", searchPath: "search_path=\"\"" },
  { signature: "create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])", md5: "01148b79df5aaa2556c80cbb63a71c68", searchPath: "search_path=\"\"" },
  { signature: "create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])", md5: "b3ff32e6f6ba86b371221a987ec9015a", searchPath: "search_path=\"\"" },
  { signature: "list_my_shop_vouchers()", md5: "99e46c89ba9adf33447f2ba4bfc75cd5", searchPath: "search_path=\"\"" },
  { signature: "list_shop_checkout_vouchers(uuid,integer,numeric,numeric)", md5: "2486c9c78abd60ada2c21fecec57fa81", searchPath: "search_path=\"\"" },
  { signature: "mark_my_shop_vouchers_seen()", md5: "0761d56bbfee9ad3932ed5ba06e90dba", searchPath: "search_path=\"\"" },
];

for (const target of targets) {
  assert.ok(draft.includes(target.signature), "Missing exact signature: " + target.signature);
  assert.ok(draft.includes(target.md5), "Missing fail-closed Production fingerprint: " + target.signature);
  assert.ok(draft.includes(target.searchPath), "Missing Production search_path: " + target.signature);
}

for (const marker of [
  "STAGE7_POST_STAGE3_RPC_COUNT_MISMATCH",
  "STAGE7_POST_STAGE3_RPC_SOURCE_OR_METADATA_DRIFT",
  "STAGE7_POST_STAGE3_RPC_ACL_RESTORE_POSTCONDITION_FAILED",
  "STAGE7_POST_STAGE3_RPC_ACL_GRANTEE_SET_DRIFT",
  "STAGE7_POST_STAGE3_RPC_AUTH_ANCHOR_DRIFT",
  "STAGE7_POST_STAGE3_RPC_ISSUER_GUARD_POSTCONDITION_FAILED",
  "STAGE7_POST_STAGE3_RPC_METADATA_OR_ACL_MUTATED",
  "STAGE7_POST_STAGE3_RPC_EXECUTE_BOUNDARY_MUTATED",
  "STAGE7_VOUCHER_TRIGGER_FUNCTION_FINGERPRINT_OR_ACL_DRIFT",
  "STAGE7_VOUCHER_TRIGGER_ACL_NOT_RESTRICTED",
  "STAGE7_VOUCHER_TRIGGER_DISABLED_OR_DETACHED",
]) {
  assert.ok(draft.includes(marker), "Missing SQL fail-closed assertion: " + marker);
}

assert.match(draft, /private\.current_user_is_better_auth\(\)/);
assert.ok(draft.includes("v_begin_position := pg_catalog.strpos(v_expected.auth_anchor, 'begin')"));
assert.ok(draft.includes("v_replacement := 'begin' || E'\\n  ' || v_guard"),
  "Issuer check must be injected inside BEGIN, before auth.uid and table access.");
assert.ok(draft.includes("v_oid := pg_catalog.to_regprocedure(v_expected.signature);"));
assert.ok(runtime.includes("INSERT INTO private.app_users (id, identity_origin)"),
  "Independent acceptance must seed its Better Auth identity in the rollback transaction.");
assert.match(draft, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.equal((draft.match(/'BETTER_AUTH_ISSUER_REQUIRED'/g) ?? []).length, 1);
assert.match(draft, /REVOKE ALL PRIVILEGES ON FUNCTION private\.sync_shop_voucher_order_status\(\)/);
assert.equal(draft.split("\\n").filter((line) => line.startsWith("REVOKE ALL PRIVILEGES ON FUNCTION public.")).length, 8,
  "Reconstruct only eight reviewed user RPC ACLs in the disposable restore.");
assert.equal(draft.split("\\n").filter((line) => line.startsWith("GRANT EXECUTE ON FUNCTION public.")).length, 8);
assert.ok(draft.includes("FROM PUBLIC, anon, authenticated, service_role;"));
assert.ok(draft.includes("TO authenticated, service_role;"));
assert.ok(draft.includes("STAGE7_POST_STAGE3_RPC_ACL_RESTORE_POSTCONDITION_FAILED"));
assert.doesNotMatch(draft, /ALTER TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE public[.]/i,
  "Draft may not mutate application tables or data.");

for (const signature of targets.map((x) => x.signature)) {
  assert.ok(runtime.includes(signature.split("(")[0]), "Runtime regression missing: " + signature);
}
assert.match(runtime, /mvdczyitbkxkldjughor\.supabase\.co\/auth\/v1/);
assert.match(runtime, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);
assert.match(runtime, /STAGE7_POST_STAGE3_LEGACY_ISSUER_NOT_DENIED/);
assert.match(runtime, /STAGE7_POST_STAGE3_BETTER_AUTH_SCOPE_FAILED/);
assert.match(runtime, /STAGE7_POST_STAGE3_VOUCHER_TRIGGER_EXECUTE_OVERBROAD/);
assert.match(runtime, /ROLLBACK;/);

assert.ok(workflow.includes("docs/security/AUTH-STAGE-7-POST-STAGE3-USER-RPC-ISSUER-GUARDS-DRAFT.sql"));
assert.ok(workflow.includes("scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.contract.test.mjs"));
assert.ok(workflow.includes("scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.regression.sql"));
assert.match(workflow, /Apply Stage 7 post-Stage-3 user RPC issuer guards to disposable restore only/);
assert.match(workflow, /Run Stage 7 post-Stage-3 user RPC issuer acceptance on disposable restore only/);
assert.ok(prWorkflow.includes("stage7-post-stage3-user-rpc-issuer-guards.contract.test.mjs"));

console.log("Stage 7 post-Stage-3 user RPC issuer guard contract passed: exact Production fingerprints, preserved RPC ACL/signatures, restricted trigger ACL, and rollback-only legacy/Better Auth acceptance.");

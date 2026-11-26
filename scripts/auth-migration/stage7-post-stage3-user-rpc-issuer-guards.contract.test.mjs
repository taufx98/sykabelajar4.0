import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const draft = read("docs/security/AUTH-STAGE-7-POST-STAGE3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const stage3UserRpcDraft = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const runtime = read("scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");
const prWorkflow = read(".github/workflows/auth-schema-pr-contracts.yml");

const targets = [
  { signature: "create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)", productionMd5: "8efe8ac377bf4eb71698eee52c61d03c", postStage3Md5: "846e2104e70e2ac3cc4c39003f4dc5aa", searchPath: "search_path=public, private, pg_catalog" },
  { signature: "create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)", productionMd5: "55e3959c23dfc492155807f230ed16e4", postStage3Md5: "b6854e75a8f23404f42179ebfb99a412", searchPath: "search_path=\"\"" },
  { signature: "create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])", productionMd5: "ed717139d1d9ec7053e25064b928bdf8", postStage3Md5: "b6f489a29525d0c893aca3f047ca2795", searchPath: "search_path=\"\"" },
  { signature: "create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])", productionMd5: "01148b79df5aaa2556c80cbb63a71c68", postStage3Md5: "65fc84c1ca725a2746a66dc67a6299e3", searchPath: "search_path=\"\"" },
  { signature: "create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])", productionMd5: "b3ff32e6f6ba86b371221a987ec9015a", postStage3Md5: "ea2fdde9078f369313a6a7a6928223f5", searchPath: "search_path=\"\"" },
  { signature: "list_my_shop_vouchers()", productionMd5: "99e46c89ba9adf33447f2ba4bfc75cd5", postStage3Md5: "44f8d1c2a5765720dd5c68c69b26ed36", searchPath: "search_path=\"\"" },
  { signature: "list_shop_checkout_vouchers(uuid,integer,numeric,numeric)", productionMd5: "2486c9c78abd60ada2c21fecec57fa81", postStage3Md5: "9b9fa2aafc79cde0ea5e16b81cebce62", searchPath: "search_path=\"\"" },
  { signature: "mark_my_shop_vouchers_seen()", productionMd5: "0761d56bbfee9ad3932ed5ba06e90dba", postStage3Md5: "c315de321fcd77bf43474254aa9509ee", searchPath: "search_path=\"\"" },
];

function extractFunctionBody(source, signature) {
  const name = signature.slice(0, signature.indexOf("("));
  const start = source.toLowerCase().indexOf("create or replace function public." + name.toLowerCase() + "(");
  assert.ok(start >= 0, "Stage 3 draft is missing function replacement: " + signature);
  const bodyStart = source.indexOf("AS $function$", start);
  const bodyEnd = source.indexOf("$function$;", bodyStart);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, "Stage 3 replacement delimiters missing: " + signature);
  return source.slice(bodyStart + "AS $function$".length, bodyEnd);
}

for (const target of targets) {
  assert.ok(draft.includes(target.signature), "Missing exact signature: " + target.signature);
  assert.match(target.productionMd5, /^[a-f0-9]{32}$/,
    "Original Production fingerprint must remain recorded in the contract: " + target.signature);
  assert.ok(draft.includes(target.postStage3Md5),
    "Exact post-Stage-3 fingerprint missing from SQL preflight: " + target.signature);
  assert.ok(draft.includes(target.searchPath), "Expected search_path is missing: " + target.signature);
  const body = extractFunctionBody(stage3UserRpcDraft, target.signature);
  const digest = createHash("md5").update(body, "utf8").digest("hex");
  assert.equal(digest, target.postStage3Md5,
    "Stage 3 issuer replacement changed after its preflight fingerprint was reviewed: " + target.signature);
  assert.ok(body.includes("private.current_user_is_better_auth()"),
    "Stage 3 replacement must already include the Better Auth issuer check: " + target.signature);
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
assert.match(draft, /pg_catalog\.substr\(v_expected\.auth_anchor, v_begin_position \+ 5\)/);
assert.doesNotMatch(draft, /pg_catalog\.substring\(v_expected\.auth_anchor FROM/);

assert.ok(draft.includes("v_replacement := 'begin' || E'\\n  ' || v_guard"),
  "Issuer check must be injected inside BEGIN, before auth.uid and table access.");
assert.ok(draft.includes("v_oid := pg_catalog.to_regprocedure(v_expected.signature);"));
assert.ok(runtime.includes("INSERT INTO private.app_users (id, identity_origin)"),
  "Independent acceptance must seed its Better Auth identity in the rollback transaction.");
assert.match(draft, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.equal((draft.match(/'BETTER_AUTH_ISSUER_REQUIRED'/g) ?? []).length, 1);
assert.match(draft, /REVOKE ALL PRIVILEGES ON FUNCTION private\.sync_shop_voucher_order_status\(\)/);
assert.ok(draft.includes(") IN (1, 2)"),
  "Trigger preflight may accept only the default PUBLIC+postgres ACL or normalized postgres-only ACL.");
assert.ok(draft.includes("grantee.rolname = 'postgres'"));
assert.ok(draft.includes("acl.grantee = 0"));
assert.doesNotMatch(draft, /p\.proacl IS NULL/,
  "The schema-only restore may represent the same safe ACL as an explicit owner-only ACL.");
assert.ok(draft.includes("STAGE7_VOUCHER_TRIGGER_FUNCTION_FINGERPRINT_OR_ACL_DRIFT:expected_md5=%:actual_md5=%"));
assert.ok(draft.includes("n.nspname = 'private'"));
assert.ok(draft.includes("p.proname = 'sync_shop_voucher_order_status'"));
assert.match(draft, /pg_catalog\.cardinality\(p\.proargtypes::oid\[\]\)\s*=\s*0/,
  "Zero-argument voucher trigger must be checked by cardinality; empty-array equality is not stable for oidvector casts.");
assert.doesNotMatch(draft, /p\.proargtypes::oid\[\]\s*=\s*ARRAY\[\]::oid\[\]/);

assert.doesNotMatch(draft, /b\.signature\s*=/,
  "Trigger preflight must not depend on search_path-sensitive regprocedure display text.");


assert.equal(draft.split("REVOKE ALL PRIVILEGES ON FUNCTION public.").length - 1, 8,
  "Reconstruct only eight reviewed user RPC ACLs in the disposable restore.");
assert.equal(draft.split("GRANT EXECUTE ON FUNCTION public.").length - 1, 8);
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

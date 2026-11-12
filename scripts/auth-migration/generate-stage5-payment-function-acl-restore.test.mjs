import assert from "node:assert/strict";
import { renderPaymentFunctionAclRestore } from "./generate-stage5-payment-function-acl-restore.mjs";

const metadata = {
  stage5_payment_fulfillment_function: {
    schema_name: "public",
    function_name: "process_payment_gateway_success",
    identity_arguments: "p_order_id uuid, p_provider text, p_payment_intent_id uuid",
    security_definer: true,
    function_config: ["search_path=public, private, pg_catalog"],
    function_acl_entries: [
      { grantee: "postgres", privilege_type: "EXECUTE", is_grantable: true, grantor: "postgres" },
      { grantee: "service_role", privilege_type: "EXECUTE", is_grantable: false, grantor: "postgres" },
    ],
    anon_execute: false,
    authenticated_execute: false,
    service_role_execute: true,
    postgres_execute: true,
  },
};

const sql = renderPaymentFunctionAclRestore(metadata);
assert.match(sql, /REVOKE ALL PRIVILEGES ON FUNCTION public\.process_payment_gateway_success\(uuid,text,uuid\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_payment_gateway_success\(uuid,text,uuid\) TO service_role/);
assert.match(sql, /STAGE5_PAYMENT_ACL_RESTORE_POSTCONDITION_FAILED/);
assert.doesNotMatch(sql, /TO PUBLIC|TO anon|TO authenticated/);

for (const mutate of [
  row => { row.anon_execute = true; },
  row => { row.authenticated_execute = true; },
  row => { row.service_role_execute = false; },
  row => { row.function_acl_entries.push({ grantee: "PUBLIC", privilege_type: "EXECUTE", is_grantable: false, grantor: "postgres" }); },
  row => { row.function_acl_entries.push({ grantee: "anon", privilege_type: "EXECUTE", is_grantable: false, grantor: "postgres" }); },
  row => { row.function_acl_entries[1].grantor = "authenticated"; },
  row => { row.function_acl_entries[1].is_grantable = true; },
  row => { row.function_config = ["search_path=public"]; },
]) {
  const bad = structuredClone(metadata);
  mutate(bad.stage5_payment_fulfillment_function);
  assert.throws(() => renderPaymentFunctionAclRestore(bad));
}
assert.throws(() => renderPaymentFunctionAclRestore({}), /metadata is missing/);
console.log("Stage 5 payment function ACL restore tests passed: exact Production postgres-owner/service_role ACL only.");

import assert from "node:assert/strict";
import { verifyStage3BaselineMetadata } from "./verify-stage3-baseline-metadata.mjs";

const makeMetadata = () => ({
  auth_dependent_functions: Array.from({ length: 10 }, (_, i) => ({ name: "function_" + i, definition_md5: "f" + i })),
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
  auth_and_profile_triggers: Array.from({ length: 7 }, (_, i) => ({ name: "trigger_" + i, definition_md5: "t" + i })),
  uid_policies: Array.from({ length: 109 }, (_, i) => ({ name: "policy_" + i, using_expression_md5: "u" + i, check_expression_md5: "c" + i })),
  uid_policy_tables: Array.from({ length: 61 }, (_, i) => ({ name: "table_" + i, row_security_enabled: true })),
  profile_columns: Array.from({ length: 36 }, (_, i) => ({ ordinal_position: i + 1, name: "column_" + i, data_type: "text" })),
});

const production = makeMetadata();
const restored = structuredClone(production);
const result = verifyStage3BaselineMetadata(production, restored);
assert.deepEqual(result, {
  functions: 10,
  triggers: 7,
  policies: 109,
  policyTables: 61,
  profileColumns: 36,
});

const changedFunction = structuredClone(production);
changedFunction.auth_dependent_functions[0].definition_md5 = "drift";
assert.throws(() => verifyStage3BaselineMetadata(production, changedFunction),
  /metadata differs from the production snapshot/);

const missingPolicy = structuredClone(production);
missingPolicy.uid_policies.pop();
assert.throws(() => verifyStage3BaselineMetadata(production, missingPolicy),
  /metadata count changed for uid_policies/);

const changedProfileColumn = structuredClone(production);
changedProfileColumn.profile_columns[0].data_type = "uuid";
assert.throws(() => verifyStage3BaselineMetadata(production, changedProfileColumn),
  /metadata differs from the production snapshot/);

console.log("Stage 3 metadata parity tests passed: exact metadata accepted; function, RLS and profile drift rejected.");

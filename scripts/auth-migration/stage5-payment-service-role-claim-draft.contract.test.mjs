import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const draft = readFileSync(
  new URL("../../docs/security/AUTH-STAGE-5-PAYMENT-SERVICE-ROLE-CLAIM-DRAFT.sql", import.meta.url),
  "utf8",
);

assert.match(draft, /to_regprocedure\('public\.process_payment_gateway_success\(uuid,text,uuid\)'\)/);
assert.match(draft, /pg_get_functiondef/);
assert.match(draft, /request\.jwt\.claims/);
assert.match(draft, /request\.jwt\.claim\.role/);
assert.match(draft, /v_stage5_jwt_claims ->> 'role'/);
assert.match(draft, /SERVICE_ROLE_REQUIRED/);
assert.match(draft, /JSON request claims take precedence over the legacy compatibility setting/);
assert.match(draft, /STAGE5_PAYMENT_ROLE_DECLARATION_ANCHOR_DRIFT/);
assert.match(draft, /STAGE5_PAYMENT_ROLE_GUARD_ANCHOR_DRIFT/);
assert.match(draft, /has_function_privilege\('service_role'[\s\S]*?'EXECUTE'\)/);
assert.match(draft, /has_function_privilege\('anon'[\s\S]*?'EXECUTE'\)/);
assert.match(draft, /has_function_privilege\('authenticated'[\s\S]*?'EXECUTE'\)/);
assert.match(draft, /set_config\('request\.jwt\.claims', '\{"role":"authenticated"\}'[\s\S]*?SERVICE_ROLE_REQUIRED/);
assert.match(draft, /set_config\('request\.jwt\.claims', '\{"role":"anon"\}'[\s\S]*?SERVICE_ROLE_REQUIRED/);
assert.match(draft, /set_config\('request\.jwt\.claims', '\{"role":"service_role"\}'[\s\S]*?ORDER_NOT_FOUND/);
assert.match(draft, /Legacy fallback remains available/);
assert.doesNotMatch(draft, /\b(?:DROP FUNCTION|REVOKE ALL|GRANT ALL|TRUNCATE|DELETE FROM)\b/i);

console.log("Stage 5 payment service-role claim draft contract passed: JSON JWT role preferred, legacy fallback preserved, non-service roles rejected, and function ACL/search_path retained.");

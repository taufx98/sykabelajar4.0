import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql"),
  "utf8",
);
const acceptance = readFileSync(
  path.join(here, "./stage3-issuer-guard-regression.sql"),
  "utf8",
);

assert.match(draft, /AS RESTRICTIVE FOR ALL TO authenticated/i);
assert.match(draft, /auth\.jwt\(\)\s*->>\s*''iss''/i);
assert.match(draft, /https:\/\/mvdczyitbkxkldjughor\.supabase\.co\/auth\/v1/);
assert.match(draft, /https:\/\/auth\.sykabelajar\.my\.id\/api\/auth/);
assert.match(draft, /v_expected_tables constant integer := 61/);
assert.match(draft, /STAGE3_ISSUER_GUARD_ALREADY_EXISTS/);
assert.match(draft, /STAGE3_ISSUER_GUARD_TABLE_COUNT_DRIFT/);
assert.match(acceptance, /STAGE3_ISSUER_GUARD_COVERAGE_FAILED/);
assert.match(acceptance, /STAGE3_LEGACY_ISSUER_OWNER_READ_FAILED/);
assert.match(acceptance, /STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_READ_ALLOWED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_INSERT_ALLOWED/);
assert.match(acceptance, /ROLLBACK;/);
assert.doesNotMatch(draft, /^\s*(?:ALTER TABLE|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM)\b/im,
  "issuer draft must not widen privileges, mutate application rows, or change existing policies");

console.log("Stage 3 issuer guard draft contract passed: 61 restrictive guards, two approved overlap issuers, no grant/policy rewrites.");

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
assert.doesNotMatch(draft, /https:\/\/mvdczyitbkxkldjughor\.supabase\.co\/auth\/v1/);
assert.match(draft, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);

assert.match(draft, /CREATE OR REPLACE FUNCTION private\.current_user_has_role/);
assert.match(draft, /app_user\.identity_origin = 'better_auth'/);
assert.match(draft, /CREATE OR REPLACE FUNCTION public\.is_active_admin/);
assert.match(draft, /auth\.jwt\(\) ->> 'iss'/);
assert.match(acceptance, /has_schema_privilege\(current_user, 'private', 'USAGE'\)/);
assert.doesNotMatch(
  acceptance,
  /private\.current_user_(?:is_admin|organizer_role|is_active_organizer_member)\(/i,
  "authenticated must not call private helpers directly; verify them through public SECURITY DEFINER entrypoints",
);
assert.match(acceptance, /STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED/);
assert.match(acceptance, /STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED/);

assert.match(acceptance, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);
assert.match(draft, /v_expected_tables constant integer := 61/);
assert.match(draft, /STAGE3_ISSUER_GUARD_ALREADY_EXISTS/);
assert.match(draft, /STAGE3_ISSUER_GUARD_TABLE_COUNT_DRIFT/);
assert.match(acceptance, /STAGE3_ISSUER_GUARD_COVERAGE_FAILED/);
assert.match(acceptance, /STAGE3_LEGACY_ISSUER_READ_ALLOWED/);
assert.match(acceptance, /STAGE3_LEGACY_ISSUER_INSERT_ALLOWED/);
assert.doesNotMatch(acceptance, /legacy_reference/i, "zero-start issuer acceptance must not seed legacy identity tombstones");

const tranche09FixtureStart = acceptance.indexOf("-- Stage 7 teacher/collective fixtures:");
const tranche09FixtureEnd = acceptance.indexOf(
  "INSERT INTO public.participants (\n  id, competition_id, user_id",
  tranche09FixtureStart,
);
assert.ok(tranche09FixtureStart >= 0 && tranche09FixtureEnd > tranche09FixtureStart,
  "Stage 7 collective fixture block must remain bounded");
const tranche09Fixture = acceptance.slice(tranche09FixtureStart, tranche09FixtureEnd);
assert.match(tranche09Fixture, /STAGE7_TRANCHE09_CANONICAL_PARTICIPANT_NOT_CREATED/,
  "active collective fixture must assert trigger-created canonical identity");
assert.doesNotMatch(tranche09Fixture, /INSERT INTO public\.participants/i,
  "the fixture must not manually duplicate the canonical row created by the trigger");

assert.match(acceptance, /STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_READ_ALLOWED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_INSERT_ALLOWED/);
assert.match(acceptance, /ROLLBACK;/);
assert.doesNotMatch(draft, /^\s*(?:ALTER TABLE|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM)\b/im,
  "issuer draft must not widen privileges, mutate application rows, or change existing policies");

console.log("Stage 3 issuer guard draft contract passed: 61 restrictive guards, Better Auth issuer only, legacy and foreign issuers denied.");

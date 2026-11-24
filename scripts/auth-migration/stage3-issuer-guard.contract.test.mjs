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
assert.match(tranche09Fixture, /STAGE7_TRANCHE09_OR_T12_CANONICAL_PARTICIPANT_NOT_CREATED/,
  "active collective fixture must assert trigger-created canonical identity");
assert.doesNotMatch(tranche09Fixture, /INSERT INTO public\.participants/i,
  "the fixture must not manually duplicate the canonical row created by the trigger");
assert.match(acceptance, /stage7-tranche12-collective-result-probe/);
assert.match(tranche09Fixture, /STAGE7-T12-COL-001/);
assert.match(acceptance, /STAGE7_TRANCHE12_COLLECTIVE_OWNER_RESULT_FAILED/);
assert.match(acceptance, /STAGE7_TRANCHE12_COLLECTIVE_IDOR_ALLOWED/);

const ownerMembershipSetupStart = acceptance.indexOf("-- The owner must establish their own owner membership");
const ownerMembershipSetupEnd = acceptance.indexOf(
  "INSERT INTO public.auth_issuer_guard_probe",
  ownerMembershipSetupStart,
);
assert.ok(ownerMembershipSetupStart >= 0 && ownerMembershipSetupEnd > ownerMembershipSetupStart,
  "organizer and question-bank fixture auth must remain bounded");
const ownerMembershipSetup = acceptance.slice(ownerMembershipSetupStart, ownerMembershipSetupEnd);
assert.ok(ownerMembershipSetup.includes('"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"'));
assert.ok(ownerMembershipSetup.includes('"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"'));
assert.ok(ownerMembershipSetup.includes("https://auth-prod.sykabelajar.my.id/api/auth"));
assert.ok(ownerMembershipSetup.indexOf('"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"') <
  ownerMembershipSetup.indexOf("INSERT INTO public.organizer_members"),
  "owner claims must be set before the owner governance trigger fires");
assert.ok(ownerMembershipSetup.indexOf('"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"') <
  ownerMembershipSetup.indexOf("INSERT INTO public.question_banks"),
  "Admin claims must be set before creating banks from multiple organizer scopes");
assert.ok(ownerMembershipSetup.lastIndexOf("set_config('request.jwt.claims', '{}', TRUE)") >
  ownerMembershipSetup.indexOf("INSERT INTO public.question_options"),
  "fixture claims must be cleared only after all protected organizer/question rows are created");

const questionEntitlementFixtureStart = acceptance.indexOf(
  "-- Schema-only restores contain the plan tables but not their production",
);
const questionEntitlementFixtureEnd = acceptance.indexOf(
  "INSERT INTO public.questions",
  questionEntitlementFixtureStart,
);
assert.ok(questionEntitlementFixtureStart >= 0 && questionEntitlementFixtureEnd > questionEntitlementFixtureStart,
  "organizer question fixture must seed and verify a disposable plan entitlement");
const questionEntitlementFixture = acceptance.slice(
  questionEntitlementFixtureStart,
  questionEntitlementFixtureEnd,
);
assert.ok(questionEntitlementFixture.includes("'FREE'"));
assert.ok(questionEntitlementFixture.includes("'question_limit'"));
assert.ok(questionEntitlementFixture.includes("STAGE7_QUESTION_QUOTA_FIXTURE_MISSING"));
assert.ok(questionEntitlementFixture.includes("STAGE7_ORGANIZER_PLAN_FIXTURE_MISSING"));
assert.ok(questionEntitlementFixture.includes("77777777-7777-4777-8777-777777777791"));
assert.ok(questionEntitlementFixture.includes("now() + interval '1 day'"),
  "organizer plan fixture must be active during the disposable question insert");

assert.match(acceptance, /STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_READ_ALLOWED/);
assert.match(acceptance, /STAGE3_UNTRUSTED_ISSUER_INSERT_ALLOWED/);
assert.match(acceptance, /ROLLBACK;/);
assert.doesNotMatch(draft, /^\s*(?:ALTER TABLE|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM)\b/im,
  "issuer draft must not widen privileges, mutate application rows, or change existing policies");

console.log("Stage 3 issuer guard draft contract passed: 61 restrictive guards, Better Auth issuer only, legacy and foreign issuers denied.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql"),
  "utf8",
);
const issuerRestrictionDraft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql"),
  "utf8",
);
const regression = readFileSync(
  path.join(here, "./stage3-issuer-guard-regression.sql"),
  "utf8",
);
const userRpcDraft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql"),
  "utf8",
);
const issuer = "https://auth-prod.sykabelajar.my.id/api/auth";

assert.doesNotMatch(regression, /legacy_reference/,
  "zero-start issuer fixtures must not create legacy identity tombstones");
assert.ok(regression.includes("('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'better_auth')"),
  "synthetic identity-root data must be fresh Better Auth only");
assert.ok(regression.includes(String.raw`'{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}'`),
  "the negative issuer case must use the UUID of a real synthetic Better Auth admin");
assert.match(regression, /is_active_admin\('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid\)/,
  "the same subject must fail Admin authorization under the legacy issuer");
assert.match(regression, /get_profile_connections\('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'following'\)/,
  "the same subject must fail private-profile owner access under the legacy issuer");

assert.match(draft, /CREATE OR REPLACE FUNCTION private\.current_user_is_better_auth\(\)/);
assert.match(draft, /auth\.jwt\(\)\s*->>\s*'iss'/);
assert.ok(draft.includes(issuer), "all identity guards must pin the exact Production issuer");
assert.match(draft, /au\.identity_origin = 'better_auth'/);
assert.match(draft, /REVOKE ALL ON FUNCTION private\.current_user_is_better_auth\(\) FROM PUBLIC, anon/);
assert.match(draft, /GRANT EXECUTE ON FUNCTION private\.current_user_is_better_auth\(\) TO authenticated/);

for (const name of [
  "private.current_user_has_role",
  "private.current_user_is_active_organizer_member",
  "private.current_user_organizer_role",
  "private.collective_realtime_can_read",
  "private.collective_realtime_bind",
  "public.is_active_admin",
  "public.admin_adjust_user_currency",
  "public.admin_bulk_adjust_currency",
  "public.admin_set_certificate_status",
  "public.admin_set_collective_certificate_price",
  "public.admin_transition_certificate",
  "public.admin_transition_order",
  "public.auto_grade_essay_item",
  "public.create_collective_participants",
  "public.generate_awards_for_competition",
  "public.is_public_profile_admin",
  "public.issue_certificate_for_award",
  "public.list_teacher_achievement_report",
  "public.list_teacher_collective_certificates",
  "public.save_organizer_competition_config",
  "public.save_question_with_options",
]) {
  assert.match(
    draft,
    new RegExp("CREATE OR REPLACE FUNCTION " + name.replaceAll(".", "\\."), "i"),
    "missing guarded SECURITY DEFINER function: " + name,
  );
}

const adminFunctions = [
  "public.admin_adjust_user_currency",
  "public.admin_bulk_adjust_currency",
  "public.admin_set_certificate_status",
  "public.admin_set_collective_certificate_price",
  "public.admin_transition_certificate",
  "public.admin_transition_order",
];
for (const name of adminFunctions) {
  const escaped = name.replaceAll(".", "\\.");
  const definition = draft.match(new RegExp("CREATE OR REPLACE FUNCTION " + escaped + "[\\s\\S]*?\\$function\\$;", "i"))?.[0] ?? "";
  assert.ok(definition, "missing complete function body: " + name);
  assert.match(definition, /private\.current_user_is_admin\(\)/,
    "Admin RPC must use the issuer-gated shared helper: " + name);
  assert.doesNotMatch(definition, /FROM\s+(?:public\.)?user_roles\b/i,
    "Admin RPC must not independently authorize a legacy user_roles row: " + name);
}

for (const name of [
  "public.auto_grade_essay_item",
  "public.generate_awards_for_competition",
  "public.issue_certificate_for_award",
  "public.save_organizer_competition_config",
  "public.save_question_with_options",
]) {
  const escaped = name.replaceAll(".", "\\.");
  const definition = draft.match(new RegExp("CREATE OR REPLACE FUNCTION " + escaped + "[\\s\\S]*?\\$function\\$;", "i"))?.[0] ?? "";
  assert.ok(definition, "missing complete function body: " + name);
  if (name === "public.save_organizer_competition_config") {
    assert.match(definition,
      /SELECT c\.organizer_id[\s\S]*?private\.current_user_is_active_organizer_member\(c\.organizer_id\)/i,
      "organizer config lookup must scope the initial row read to the issuer-gated membership helper");
  } else if (name === "public.save_question_with_options") {
    assert.match(definition,
      /SELECT qb\.organizer_id[\s\S]*?private\.current_user_is_active_organizer_member\(qb\.organizer_id\)/i,
      "question bank lookup must scope the initial row read to the issuer-gated membership helper");
  } else {
    assert.match(definition, /private\.current_user_is_active_organizer_member\(v_org\)/,
      "organizer operations must use the issuer-gated membership helper: " + name);
  }
  assert.match(definition, /private\.current_user_is_admin\(\)/,
    "organizer operation Admin bypass must use issuer-gated helper: " + name);
}

const publicAdminProfile = draft.match(/CREATE OR REPLACE FUNCTION public\.is_public_profile_admin[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(publicAdminProfile, /JOIN private\.app_users as app_user/i);
assert.match(publicAdminProfile, /app_user\.identity_origin = 'better_auth'/);

const collectiveOptions = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_collective_registration_options\(p_competition_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";

const participantDetail = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_competition_participant_detail\(\s*p_slug text,\s*p_participant_id uuid\s*\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(participantDetail, "missing public competition participant detail replacement");
assert.match(participantDetail, /private\.current_user_is_better_auth\(\)/);
assert.match(participantDetail, /auth\.uid\(\)\) IS NOT DISTINCT FROM p\.id/);
assert.match(participantDetail, /coalesce\(p\.is_public, false\)/);
assert.match(participantDetail, /coalesce\(settings\.show_badge_collection, true\)/);

assert.match(regression, /STAGE3_ANON_PRIVATE_RESULT_BADGES_ALLOWED/);
assert.match(regression, /STAGE3_LEGACY_PRIVATE_RESULT_BADGES_ALLOWED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PRIVATE_RESULT_BADGES_ALLOWED/);
assert.match(regression, /STAGE3_BETTER_AUTH_PRIVATE_RESULT_BADGE_OWNER_FAILED/);
assert.match(regression, /public\.get_competition_participant_detail\([\s\S]*?55555555-5555-4555-8555-555555555551/);
assert.match(regression, /public\.get_competition_participant_detail\([\s\S]*?55555555-5555-4555-8555-555555555552/);
assert.ok(collectiveOptions, "missing collective registration options issuer guard");
assert.match(collectiveOptions, /private\.current_user_is_better_auth\(\)/);
assert.match(collectiveOptions, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(collectiveOptions, /visibility IS DISTINCT FROM 'PUBLIC'/);
assert.match(collectiveOptions, /private\.current_user_is_admin\(\)/);
assert.match(collectiveOptions, /private\.current_user_is_organizer_for\(v_comp\.organizer_id\)/);

const competitionStatusSync = draft.match(
  /CREATE OR REPLACE FUNCTION public\.sync_competition_registration_status\(p_competition_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(competitionStatusSync, "missing guarded public competition state-sync RPC");
assert.match(competitionStatusSync, /visibility IS DISTINCT FROM 'PUBLIC'/);
assert.match(competitionStatusSync, /private\.current_user_is_better_auth\(\)/);
assert.match(competitionStatusSync, /private\.current_user_is_admin\(\)/);
assert.match(competitionStatusSync, /private\.current_user_is_organizer_for\(v_competition\.organizer_id\)/);
assert.match(draft, /REVOKE EXECUTE ON FUNCTION public\.get_collective_registration_options\(uuid\)\s+FROM PUBLIC, anon;/);
assert.match(draft, /COLLECTIVE_OPTIONS_ANON_EXECUTE_REMAINS/);
assert.match(draft, /COLLECTIVE_OPTIONS_TRUSTED_EXECUTE_MISSING/);

const listTeacherCertificates = draft.match(/CREATE OR REPLACE FUNCTION public\.list_teacher_collective_certificates[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(listTeacherCertificates, /private\.current_user_is_better_auth\(\)/);

const individualExamAccess = draft.match(
  /CREATE OR REPLACE FUNCTION private\.assert_individual_linear_exam_access\(p_attempt_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(individualExamAccess, "missing shared individual-exam authorization helper");
assert.match(individualExamAccess, /SET search_path TO ''/);
assert.match(individualExamAccess, /private\.current_user_is_better_auth\(\)/);
assert.match(individualExamAccess, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(individualExamAccess, /preview_owner_id IS DISTINCT FROM v_uid/);
assert.match(individualExamAccess, /participant_id IS DISTINCT FROM v_uid/);

const examStartPreflight = draft.match(
  /DO \$stage7_exam_start_fingerprint_preflight\$[\s\S]*?\$stage7_exam_start_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(examStartPreflight, "missing exact Production fingerprint preflight for individual exam start");
assert.match(examStartPreflight, /04edc4504123d2afddd186c1d3fa750e/);
assert.match(examStartPreflight, /p\.prosecdef/);
assert.match(examStartPreflight, /search_path=""/);
assert.match(examStartPreflight, /has_function_privilege\('anon'/);
assert.match(examStartPreflight, /has_function_privilege\('authenticated'/);
assert.match(examStartPreflight, /has_function_privilege\('service_role'/);

const activeAttemptFixtureStart = regression.indexOf(
  "DO $stage3_exam_start_active_attempt_fixture_preflight$",
);
const activeAttemptFixtureEnd = regression.indexOf(
  "$stage3_exam_start_active_attempt_fixture_preflight$;",
  activeAttemptFixtureStart,
);
const activeAttemptFixture = activeAttemptFixtureStart >= 0 && activeAttemptFixtureEnd > activeAttemptFixtureStart
  ? regression.slice(activeAttemptFixtureStart, activeAttemptFixtureEnd)
  : "";
assert.ok(activeAttemptFixture, "missing privileged active individual-exam fixture preflight");
for (const marker of [
  "77777777-7777-4777-8777-777777777775",
  "33333333-3333-4333-8333-333333333334",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "'IN_PROGRESS'::public.attempt_status",
  "STAGE3_EXAM_START_ACTIVE_ATTEMPT_FIXTURE_MISSING",
]) assert.ok(activeAttemptFixture.includes(marker), "privileged active-attempt fixture preflight is incomplete: " + marker);
const legacyIssuerComment = regression.indexOf("-- Supabase Auth is not a trusted application login after this cutover.");
const legacyIssuerRoleSwitch = regression.indexOf("SET LOCAL ROLE authenticated;", legacyIssuerComment);
assert.ok(activeAttemptFixtureStart >= 0 && legacyIssuerComment > activeAttemptFixtureEnd &&
  legacyIssuerRoleSwitch > activeAttemptFixtureEnd,
  "active-attempt fixture must be verified before switching to the legacy authenticated JWT");
const legacyIssuerBlockStart = regression.indexOf("DO $all_user_rpc_legacy_issuer$");
const legacyIssuerBlockEnd = regression.indexOf("$all_user_rpc_legacy_issuer$;", legacyIssuerBlockStart);
const legacyIssuerBlock = legacyIssuerBlockStart >= 0 && legacyIssuerBlockEnd > legacyIssuerBlockStart
  ? regression.slice(legacyIssuerBlockStart, legacyIssuerBlockEnd)
  : "";
assert.ok(legacyIssuerBlock && !legacyIssuerBlock.includes("STAGE3_EXAM_START_ACTIVE_ATTEMPT_FIXTURE_MISSING"),
  "legacy JWT tests must not assert fixture visibility through the restrictive issuer RLS policy");

const examStart = draft.match(
  /CREATE OR REPLACE FUNCTION public\.start_linear_exam_attempt\(p_competition_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(examStart, "missing individual exam start replacement");
const examStartIssuerAt = examStart.indexOf("private.current_user_is_better_auth()");
const examStartFirstProtectedRead = examStart.indexOf("FROM public.attempts");
assert.ok(examStartIssuerAt >= 0 && examStartFirstProtectedRead > examStartIssuerAt,
  "individual exam start must validate Better Auth before its first existing-attempt lookup");
assert.match(examStart, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(examStart, /private\.prepare_linear_exam_runtime/);
assert.match(draft, /DO \$stage7_exam_start_metadata_postflight\$/);

for (const marker of [
  "STAGE3_EXAM_START_ACTIVE_ATTEMPT_FIXTURE_MISSING",
  "STAGE3_LEGACY_START_LINEAR_EXAM_ACTIVE_ATTEMPT_NOT_DENIED",
  "77777777-7777-4777-8777-777777777775",
]) assert.ok(regression.includes(marker), "missing individual exam start regression marker: " + marker);
const realtimeBind = draft.match(/CREATE OR REPLACE FUNCTION private\.collective_realtime_bind[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(realtimeBind, /private\.current_user_is_better_auth\(\)/);


assert.match(regression, /has_schema_privilege\(current_user, 'private', 'USAGE'\)/);
assert.doesNotMatch(
  regression,
  /private\.current_user_(?:is_admin|organizer_role|is_active_organizer_member)\(/i,
  "authenticated must not call private helpers directly; verify them through public SECURITY DEFINER entrypoints",
);
assert.match(regression, /STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED/);
assert.match(regression, /STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED/);

for (const marker of [
  "STAGE3_ANON_PRIVATE_PROFILE_CONNECTIONS_ALLOWED",
  "STAGE3_ANON_PUBLIC_FOLLOWING_LIST_FAILED",
  "STAGE3_ANON_HIDDEN_FOLLOWERS_LIST_ALLOWED",
  "STAGE3_ANON_SOCIAL_SUMMARY_GRANT_REMAINS",
  "STAGE3_ANON_ADMIN_DIAGNOSE_EXECUTE_REMAINS",
  "STAGE3_ANON_ADMIN_EVALUATE_BADGES_EXECUTE_REMAINS",
  "STAGE3_ANON_ADMIN_UPDATE_SYSTEM_ERROR_EXECUTE_REMAINS",
  "STAGE3_ANON_REOPEN_SYSTEM_ERROR_EXECUTE_REMAINS",
  "STAGE3_ANON_GET_FOLLOW_STATUS_EXECUTE_REMAINS",
  "STAGE3_LEGACY_PRIVATE_PROFILE_OWNER_BYPASS",
  "STAGE3_LEGACY_SOCIAL_SUMMARY_ALLOWED",
  "STAGE3_LEGACY_GET_FOLLOW_STATUS_ALLOWED",
  "STAGE3_LEGACY_ADMIN_DIAGNOSE_ALLOWED",
  "STAGE3_LEGACY_ADMIN_EVALUATE_BADGES_ALLOWED",
  "STAGE3_LEGACY_ADMIN_UPDATE_SYSTEM_ERROR_ALLOWED",
  "STAGE3_LEGACY_REOPEN_SYSTEM_ERROR_ALLOWED",
  "STAGE3_LEGACY_INDIVIDUAL_EXAM_RPC_ALLOWED",
  "STAGE3_BETTER_AUTH_INDIVIDUAL_EXAM_ISSUER_GATE_FAILED",
  "STAGE3_LEGACY_COLLECTIVE_OPTIONS_ALLOWED",
  "STAGE3_BETTER_AUTH_COLLECTIVE_OPTIONS_ISSUER_GATE_FAILED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_COLLECTIVE_OPTIONS_FAILED",
  "STAGE3_OTHER_BETTER_AUTH_PRIVATE_COLLECTIVE_OPTIONS_ALLOWED",
  "STAGE3_OTHER_BETTER_AUTH_PUBLIC_COLLECTIVE_OPTIONS_FAILED",
  "STAGE3_ANON_COLLECTIVE_OPTIONS_EXECUTE_REMAINS",
  "STAGE3_ANON_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED",
  "STAGE3_ANON_PUBLIC_COMPETITION_STATUS_SYNC_FAILED",
  "STAGE3_LEGACY_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_STATUS_SYNC_FAILED",
  "STAGE3_OTHER_BETTER_AUTH_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED",
  "STAGE3_OTHER_BETTER_AUTH_PUBLIC_STATUS_SYNC_FAILED",
  "STAGE3_BETTER_AUTH_PRIVATE_OWNER_CONNECTIONS_FAILED",
  "STAGE3_BETTER_AUTH_PRIVATE_OWNER_FOLLOWERS_FAILED",
  "STAGE3_BETTER_AUTH_PRIVATE_OWNER_SOCIAL_FAILED",
  "STAGE3_BETTER_AUTH_PUBLIC_SOCIAL_FAILED",
  "STAGE3_OTHER_BETTER_AUTH_PRIVATE_CONNECTIONS_ALLOWED",
  "STAGE3_OTHER_BETTER_AUTH_PRIVATE_SOCIAL_ALLOWED",
  "STAGE3_OTHER_BETTER_AUTH_PUBLIC_SOCIAL_FAILED",
]) {
  assert.ok(regression.includes(marker), "missing disposable profile privacy assertion: " + marker);
}
assert.match(regression, /SET LOCAL ROLE anon[\s\S]*?public\.get_profile_connections/);
assert.match(regression, /public\.get_public_profile_social[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(regression, /public\.get_follow_status[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(regression, /public\.admin_diagnose_organizer_voucher_delete[\s\S]*?ADMIN_REQUIRED/);
assert.match(regression, /public\.admin_evaluate_badges\(\)[\s\S]*?ACCESS_DENIED/);
assert.match(regression, /public\.admin_update_system_error_status[\s\S]*?ADMIN_REQUIRED/);
assert.match(regression, /public\.reopen_system_error_incident[\s\S]*?ADMIN_REQUIRED/);
assert.match(regression, /public\.get_linear_exam_state[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(regression, /ATTEMPT_NOT_FOUND'[\s\S]*?STAGE3_BETTER_AUTH_INDIVIDUAL_EXAM_ISSUER_GATE_FAILED/);
assert.match(regression, /public\.get_collective_registration_options[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(regression, /COMPETITION_NOT_FOUND'[\s\S]*?STAGE3_BETTER_AUTH_COLLECTIVE_OPTIONS_ISSUER_GATE_FAILED/);
assert.match(regression, /public\.get_collective_registration_options\('22222222-2222-4222-8222-222222222222'::uuid\)[\s\S]*?STAGE3_BETTER_AUTH_ADMIN_PRIVATE_COLLECTIVE_OPTIONS_FAILED/);
assert.match(regression, /public\.sync_competition_registration_status\('11111111-1111-4111-8111-111111111111'::uuid\)[\s\S]*?STAGE3_ANON_PUBLIC_COMPETITION_STATUS_SYNC_FAILED/);
assert.match(regression, /public\.sync_competition_registration_status\('22222222-2222-4222-8222-222222222222'::uuid\)[\s\S]*?STAGE3_ANON_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED/);
assert.match(regression, /STAGE3_LEGACY_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED/);
assert.match(regression, /STAGE3_BETTER_AUTH_ADMIN_PRIVATE_STATUS_SYNC_FAILED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PUBLIC_STATUS_SYNC_FAILED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PRIVATE_COLLECTIVE_OPTIONS_ALLOWED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PUBLIC_COLLECTIVE_OPTIONS_FAILED/);
assert.match(regression, /has_function_privilege\('anon',[\s\S]*?STAGE3_ANON_ADMIN_DIAGNOSE_EXECUTE_REMAINS/);
assert.match(regression, /public\.admin_diagnose_organizer_voucher_delete[\s\S]*?STAGE3_BETTER_AUTH_ADMIN_DIAGNOSE_RPC_FAILED/);
assert.match(regression, /public\.admin_evaluate_badges\(\)/);
assert.match(regression, /public\.get_follow_status[\s\S]*?STAGE3_BETTER_AUTH_GET_FOLLOW_STATUS_FAILED/);
assert.match(regression, /RESET ROLE;\s*SET LOCAL ROLE authenticated/);
assert.doesNotMatch(draft, /^(?:ALTER TABLE|DROP POLICY|INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM)\b/im,
  "draft must not mutate application data or replace RLS policy state");


const profileConnections = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_profile_connections\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(profileConnections, "missing profile-connections RPC replacement");
assert.match(profileConnections, /COALESCE\(profile\.is_public, false\)/);
assert.match(profileConnections, /private\.app_users[\s\S]*identity_origin = 'better_auth'/);
assert.match(profileConnections, /NOT v_profile_is_public[\s\S]*NOT COALESCE\(v_is_better_auth_owner, false\)/);

const profileBadgeVisibility = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_profile_badge_visibility\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(profileBadgeVisibility, /private\.current_user_is_better_auth\(\)\s+AND\s+private\.current_user_is_admin\(\)/);

const profileBadges = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_profile_badges\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(profileBadges, /private\.current_user_is_better_auth\(\)\s+AND\s+private\.current_user_is_admin\(\)/);

const profileUiSettings = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_profile_ui_settings\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.equal(
  [...profileUiSettings.matchAll(/private\.current_user_is_better_auth\(\)\s+AND\s+private\.current_user_is_admin\(\)/g)].length,
  3,
  "every private-profile UI Admin bypass must require Better Auth",
);

const profileSocial = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_profile_social\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(profileSocial, /v_is_better_auth_admin :=[\s\S]*private\.current_user_is_better_auth\(\)[\s\S]*private\.current_user_is_admin\(\)/);
assert.match(profileSocial, /IF NOT v_is_public[\s\S]*NOT v_is_better_auth_owner[\s\S]*NOT v_is_better_auth_admin/);

for (const marker of [
  "STAGE3_LEGACY_ADMIN_PRIVATE_BADGE_VISIBILITY_ALLOWED",
  "STAGE3_LEGACY_ADMIN_PRIVATE_BADGES_ALLOWED",
  "STAGE3_LEGACY_ADMIN_PRIVATE_UI_SETTINGS_ALLOWED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_BADGE_VISIBILITY_FAILED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_BADGES_FAILED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_UI_SETTINGS_FAILED",
  "STAGE3_BETTER_AUTH_ADMIN_PRIVATE_SOCIAL_FAILED",
]) {
  assert.ok(regression.includes(marker), "missing verified Admin/private-profile regression: " + marker);
}


const adminRpcLegacyBlock = regression.match(
  /DO \$legacy_user_rpc_issuer_gate\$[\s\S]*?\$legacy_user_rpc_issuer_gate\$;/i,
)?.[0] ?? "";
const adminRpcBetterAuthBlock = regression.match(
  /DO \$better_auth_issuer\$[\s\S]*?\$better_auth_issuer\$;/i,
)?.[0] ?? "";
assert.ok(adminRpcLegacyBlock, "missing legacy issuer Admin RPC regression block");
assert.ok(adminRpcBetterAuthBlock, "missing Better Auth Admin RPC regression block");

const reviewedAdminRpcCases = [
  "admin_adjust_user_currency",
  "admin_bulk_adjust_currency",
  "admin_assign_organizer_plan",
  "admin_change_username",
  "admin_create_organizer",
  "admin_create_organizer_payment_method",
];
for (const name of reviewedAdminRpcCases) {
  assert.ok(
    adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name,
  );
  assert.ok(
    adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth positive issuer assertion: " + name,
  );
}

const currentUserHasRole = draft.match(
  /CREATE OR REPLACE FUNCTION private\.current_user_has_role\(p_role public\.app_role\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(currentUserHasRole, "missing Stage 3 current_user_has_role replacement");
assert.match(currentUserHasRole, /private\.current_user_is_better_auth\(\)/);
assert.match(currentUserHasRole, /ur\.user_id = \(SELECT auth\.uid\(\)\)/);
assert.match(currentUserHasRole, /ur\.is_active = TRUE/);


const reviewedAdminMutationCases = [
  "admin_delete_competition",
  "admin_force_delete_competition",
  "admin_force_complete_pending_order",
  "admin_review_manual_order",
  "admin_set_user_role",
  "admin_set_user_status",
  "admin_issue_shop_voucher",
  "admin_save_shop_voucher_definition",
  "admin_set_comment_moderation",
  "admin_update_referral_program_settings",
];
for (const name of reviewedAdminMutationCases) {
  assert.ok(
    adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name,
  );
  assert.ok(
    adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth no-write business-boundary assertion: " + name,
  );
}
assert.match(adminRpcBetterAuthBlock, /admin_set_user_role[\s\S]*?foreign_key_violation/);
assert.match(adminRpcBetterAuthBlock, /admin_force_complete_pending_order[\s\S]*?ORDER_NOT_FOUND/);
assert.match(adminRpcBetterAuthBlock, /admin_review_manual_order[\s\S]*?ORDER_NOT_FOUND/);


const issuerFirstFunctionNames = [
  "auto_grade_essay_item",
  "generate_awards_for_competition",
  "issue_certificate_for_award",
  "create_collective_certificate_order",
  "assign_organizer_serial",
  "create_certificate_asset",
];
const firstProtectedReadPatterns = {
  auto_grade_essay_item: /SELECT\s+\*\s+INTO\s+v_attempt/i,
  generate_awards_for_competition: /SELECT\s+organizer_id\s+INTO\s+v_org/i,
  issue_certificate_for_award: /SELECT\s+\*\s+INTO\s+v_award/i,
  create_collective_certificate_order: /v_price\s*:=\s*public\.get_collective_certificate_price\(\)/i,
  assign_organizer_serial: /SELECT\s+s\.\*\s+INTO\s+v_serial/i,
  create_certificate_asset: /SELECT\s+c\.\*\s+INTO\s+v_cert/i,
};
for (const name of issuerFirstFunctionNames) {
  const definition = draft.match(
    new RegExp("CREATE OR REPLACE FUNCTION public\\." + name + "\\([\\s\\S]*?\\$function\\$;", "i"),
  )?.[0] ?? "";
  assert.ok(definition, "missing guarded function definition: " + name);
  const issuerCheck = definition.search(/private\.current_user_is_better_auth\(\)/i);
  const firstProtectedRead = definition.search(firstProtectedReadPatterns[name]);
  assert.ok(issuerCheck >= 0, "missing explicit Better Auth issuer check: " + name);
  assert.ok(firstProtectedRead >= 0 && issuerCheck < firstProtectedRead,
    "issuer check must precede first protected row/config read: " + name);
}

const trancheFourCases = [
  ["auto_grade_essay_item", "STAGE3_LEGACY_USER_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:"],
  ["generate_awards_for_competition", "STAGE3_LEGACY_USER_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:"],
  ["issue_certificate_for_award", "STAGE3_LEGACY_USER_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:"],
  ["admin_set_certificate_status", "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:"],
  ["admin_transition_certificate", "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:"],
  ["admin_transition_order", "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:", "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:"],
];
for (const [name, legacyPrefix, betterAuthPrefix] of trancheFourCases) {
  assert.ok(adminRpcLegacyBlock.includes(legacyPrefix + name),
    "missing legacy-issuer denial assertion: " + name);
  assert.ok(adminRpcBetterAuthBlock.includes(betterAuthPrefix + name),
    "missing Better Auth positive-path assertion: " + name);
}


const trancheFiveAdminCases = [
  "admin_delete_organizer_payment_method",
  "admin_delete_post",
  "admin_delete_product",
  "admin_delete_shop_promo_banner",
  "admin_get_attempt_investigation",
  "admin_get_competition_delete_blockers",
  "admin_get_monitoring_dashboard",
  "admin_list_issued_shop_vouchers",
  "admin_list_shop_promo_banners",
  "admin_list_shop_voucher_definitions",
];
const stage7MorePositive = regression.match(
  /DO \$stage7_more_admin_positive\$[\s\S]*?\$stage7_more_admin_positive\$;/i,
)?.[0] ?? "";
assert.ok(stage7MorePositive, "missing tranche 05 Better Auth positive Admin block");
for (const name of trancheFiveAdminCases) {
  assert.ok(adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name);
  assert.ok(stage7MorePositive.includes("admin_" + name.replace(/^admin_/, "")) || stage7MorePositive.includes("public." + name),
    "missing Better Auth Admin positive call: " + name);
  assert.ok(stage7MorePositive.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth Admin positive assertion: " + name);
}


const trancheSixAdminCases = [
  "admin_delete_organizer_voucher",
  "admin_generate_organizer_vouchers",
  "admin_save_organizer_payment_fields",
  "admin_save_plan_bundle",
  "admin_upsert_organizer_voucher",
  "admin_update_referral_program_settings_v2",
  "admin_save_competition",
  "admin_save_post",
  "admin_save_product",
  "admin_save_shop_promo_banner",
];
const stage7AdminValidationPositive = regression.match(
  /DO \$stage7_admin_mutation_validation_positive\$[\s\S]*?\$stage7_admin_mutation_validation_positive\$;/i,
)?.[0] ?? "";
assert.ok(stage7AdminValidationPositive, "missing tranche 06 Better Auth validation block");
for (const name of trancheSixAdminCases) {
  assert.ok(adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name);
  assert.ok(stage7AdminValidationPositive.includes("public." + name + "("),
    "missing Better Auth validation call: " + name);
  assert.ok(stage7AdminValidationPositive.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth validation assertion: " + name);
}


const trancheSevenAdminCases = [
  "admin_save_organizer_payment_config",
  "admin_set_collective_certificate_price",
];
for (const name of trancheSevenAdminCases) {
  assert.ok(adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name);
  assert.ok(adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth positive/boundary assertion: " + name);
}
assert.match(adminRpcBetterAuthBlock,
  /admin_save_organizer_payment_config[\s\S]*?STAGE3_ADMIN_PAYMENT_CONFIG_ROLLBACK_SENTINEL/);
assert.match(adminRpcBetterAuthBlock,
  /admin_set_collective_certificate_price\(NULL::numeric\)[\s\S]*?INVALID_AMOUNT/);
assert.match(draft,
  /CREATE OR REPLACE FUNCTION public\.admin_set_collective_certificate_price[\s\S]*?private\.current_user_is_admin\(\)/);
assert.doesNotMatch(
  draft.match(/CREATE OR REPLACE FUNCTION public\.admin_set_collective_certificate_price[\s\S]*?\$function\$;/)?.[0] ?? "",
  /FROM\s+(?:public\.)?user_roles\b/i,
  "collective certificate price must not authorize from a legacy role row",
);


const trancheEightFunctionNames = [
  "create_collective_certificate_order",
  "assign_organizer_serial",
  "create_certificate_asset",
];
for (const name of trancheEightFunctionNames) {
  assert.ok(
    adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name,
  );
  assert.ok(
    adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth boundary assertion: " + name,
  );
}
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.create_collective_certificate_order[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /private\.current_user_is_better_auth\(\)[\s\S]*?v_price := public\.get_collective_certificate_price\(\)/,
  "collective certificate pricing must be read only after Better Auth issuer validation",
);
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.create_collective_certificate_order[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /cp\.managed_by_user_id = v_uid[\s\S]*?private\.current_user_is_admin\(\)/,
  "collective certificate order must scope lookup to participant owner or Admin",
);
assert.doesNotMatch(
  draft.match(/CREATE OR REPLACE FUNCTION public\.create_collective_certificate_order[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /FROM\s+(?:public\.)?user_roles\b/i,
  "collective certificate orders must not authorize from legacy user_roles",
);

const assignOrganizerSerial = draft.match(
  /CREATE OR REPLACE FUNCTION public\.assign_organizer_serial[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(assignOrganizerSerial,
  /FROM public\.organizer_serials s[\s\S]*?private\.current_user_can_manage_organizer\(s\.organizer_id\)/i,
  "serial lookup must be scoped to its owner organizer or Admin");
assert.match(assignOrganizerSerial,
  /JOIN public\.competitions comp[\s\S]*?comp\.organizer_id = v_serial\.organizer_id[\s\S]*?private\.current_user_can_manage_organizer\(comp\.organizer_id\)/i,
  "certificate lookup must be scoped to the serial's organizer or Admin");

const createCertificateAsset = draft.match(
  /CREATE OR REPLACE FUNCTION public\.create_certificate_asset[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(createCertificateAsset,
  /c\.user_id = v_uid[\s\S]*?private\.current_user_is_admin\(\)[\s\S]*?private\.current_user_is_organizer_for\(comp\.organizer_id\)/i,
  "certificate asset lookup must be scoped to owner, Admin, or authorized organizer");


const collectiveOrderDefinition = draft.match(
  /CREATE OR REPLACE FUNCTION public\.create_collective_certificate_order[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(collectiveOrderDefinition,
  /SELECT cc\.\*[\s\S]*?INTO v_cert[\s\S]*?FOR UPDATE OF cc[\s\S]*?SELECT cp\.\*[\s\S]*?INTO v_cp/i,
  "collective certificate and participant rows must be loaded with separate typed INTO targets");
assert.doesNotMatch(collectiveOrderDefinition,
  /SELECT\s+cc\s*,\s*cp\s+INTO\s+v_cert\s*,\s*v_cp/i,
  "PL/pgSQL cannot assign composite row variables in a multi-item INTO target list");


const trancheNineCases = [
  "create_collective_participants",
  "save_organizer_competition_config",
  "list_teacher_collective_certificates",
  "list_teacher_achievement_report",
];
const trancheNineExpectedReads = {
  create_collective_participants: /SELECT\s+c\.id,\s*c\.participant_mode,\s*c\.config/i,
  save_organizer_competition_config: /SELECT\s+c\.organizer_id/i,
};
for (const name of trancheNineCases) {
  assert.ok(adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy issuer boundary: " + name);
  assert.ok(adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth acceptance/boundary: " + name);
  const definition = draft.match(
    new RegExp("CREATE OR REPLACE FUNCTION public\\." + name + "\\([\\s\\S]*?\\$function\\$;", "i"),
  )?.[0] ?? "";
  assert.ok(definition, "missing Stage 3 draft function: " + name);
  assert.match(definition, /private\.current_user_is_better_auth\(\)/i,
    "function must require the Better Auth issuer: " + name);
  assert.doesNotMatch(definition, /FROM\s+(?:public\.)?user_roles\b/i,
    "function must not check legacy user_roles directly: " + name);
}
for (const name of ["create_collective_participants", "save_organizer_competition_config"]) {
  const definition = draft.match(
    new RegExp("CREATE OR REPLACE FUNCTION public\\." + name + "\\([\\s\\S]*?\\$function\\$;", "i"),
  )?.[0] ?? "";
  const issuerCheck = definition.search(/private\.current_user_is_better_auth\(\)/i);
  const firstProtectedRead = definition.search(trancheNineExpectedReads[name]);
  assert.ok(firstProtectedRead >= 0 && issuerCheck >= 0 && issuerCheck < firstProtectedRead,
    "issuer check must precede protected SELECT: " + name);
}
const teacherCertificateList = draft.match(
  /CREATE OR REPLACE FUNCTION public\.list_teacher_collective_certificates[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(teacherCertificateList,
  /private\.current_user_is_better_auth\(\)[\s\S]*?private\.current_user_has_role\('teacher'::public\.app_role\)[\s\S]*?cp\.managed_by_user_id/i);
const teacherReport = draft.match(
  /CREATE OR REPLACE FUNCTION public\.list_teacher_achievement_report[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(
  teacherReport.search(/private\.current_user_is_better_auth\(\)/i) <
  teacherReport.search(/RETURN QUERY/i),
  "teacher achievement report must validate issuer before returning rows",
);
assert.match(regression, /Stage 7 Existing Collective Participant/);
assert.match(regression, /STAGE7-T09-NEW-001/);
assert.match(regression, /STAGE7_TRANCHE09_PARTICIPANT_CODE_COLLISION/);


assert.match(adminRpcBetterAuthBlock,
  /create_collective_certificate_order[\s\S]*?CERTIFICATE_PRICE_NOT_CONFIGURED/,
  "Better Auth collective certificate order must pass scoped issuer/owner check and stop before writes when price is unconfigured");


const trancheTenFunctionNames = [
  "create_product_order",
  "save_question_with_options",
];
for (const name of trancheTenFunctionNames) {
  assert.ok(
    adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy-issuer denial assertion: " + name,
  );
  const definition = draft.match(
    new RegExp("CREATE OR REPLACE FUNCTION public\\." + name + "\\([\\s\\S]*?\\$function\\$;", "i"),
  )?.[0] ?? "";
  assert.ok(definition, "missing Stage 3 function definition: " + name);
  assert.match(definition, /private\.current_user_is_better_auth\(\)/i,
    "function must require Better Auth issuer: " + name);
  assert.doesNotMatch(definition, /FROM\s+(?:public\.)?user_roles\b/i,
    "function must not authorize from direct legacy user_roles: " + name);
}
const productOrderDefinition = draft.match(
  /CREATE OR REPLACE FUNCTION public\.create_product_order[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(productOrderDefinition,
  /private\.current_user_is_better_auth\(\)[\s\S]*?SELECT p\.\*[\s\S]*?FROM public\.commerce_products p/i,
  "product order must verify issuer before reading product");
assert.match(productOrderDefinition,
  /private\.current_user_is_admin\(\)[\s\S]*?private\.current_user_has_role\('student'::public\.app_role\)[\s\S]*?private\.current_user_has_role\('teacher'::public\.app_role\)[\s\S]*?private\.current_user_has_role\('organizer_member'::public\.app_role\)/i,
  "product audience must be matched to the caller's issuer-gated business role");
const questionSaveDefinition = draft.match(
  /CREATE OR REPLACE FUNCTION public\.save_question_with_options[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.match(questionSaveDefinition,
  /private\.current_user_is_better_auth\(\)[\s\S]*?FROM public\.question_banks qb/i,
  "question save must verify issuer before reading the question bank");
assert.match(questionSaveDefinition,
  /private\.current_user_is_active_organizer_member\(qb\.organizer_id\)/i,
  "question bank lookup must be restricted to an active organizer member or Admin");
assert.match(questionSaveDefinition,
  /WHERE id = p_question_id\s+AND question_bank_id = p_question_bank_id/i,
  "question updates must remain within the authorized question bank");

assert.match(regression,
  /STAGE3_LEGACY_ADMIN_RPC_ALLOWED:create_product_order[\s\S]*?STAGE3_LEGACY_ADMIN_RPC_ALLOWED:save_question_with_options/);
assert.match(regression,
  /STAGE3_BETTER_AUTH_STUDENT_PRODUCT_ORDER_FAILED[\s\S]*?STAGE3_BETTER_AUTH_QUESTION_BANK_OWNERSHIP_FAILED/);
assert.match(regression,
  /STAGE3_BETTER_AUTH_QUESTION_CROSS_BANK_UPDATE_ALLOWED[\s\S]*?STAGE3_BETTER_AUTH_FOREIGN_QUESTION_OPTIONS_CHANGED/);
assert.match(regression, /STAGE7-ISSUER-PRODUCT/);
assert.match(regression, /Stage 7 Owned Question Bank/);
assert.match(regression, /STAGE7_TRANCHE10_FIXTURE_UUID_COLLISION/);

const saveQuestionDefinitionStart = draft.indexOf(
  "CREATE OR REPLACE FUNCTION public.save_question_with_options(",
);
const saveQuestionOpenDelimiter = draft.indexOf("$function$", saveQuestionDefinitionStart);
const saveQuestionCloseDelimiter = draft.indexOf("$function$", saveQuestionOpenDelimiter + "$function$".length);
assert.ok(saveQuestionDefinitionStart >= 0 && saveQuestionOpenDelimiter > saveQuestionDefinitionStart
  && saveQuestionCloseDelimiter > saveQuestionOpenDelimiter,
  "complete question save function definition must exist");
assert.equal(
  draft[saveQuestionCloseDelimiter + "$function$".length],
  ";",
  "save_question_with_options must terminate with a semicolon immediately after its closing dollar quote",
);




const trancheElevenFunctions = [
  "finalize_attempt_manual",
  "get_attempt_grading_limits",
  "publish_competition_results",
  "release_organizer_competition",
];
const trancheElevenFirstRead = {
  finalize_attempt_manual: /SELECT a\.\* INTO v_attempt[\s\S]*?FROM public\.attempts a[\s\S]*?JOIN public\.competitions c/i,
  get_attempt_grading_limits: /SELECT a\.\* INTO v_attempt[\s\S]*?FROM public\.attempts a[\s\S]*?JOIN public\.competitions c/i,
  publish_competition_results: /SELECT c\.\* INTO v_comp[\s\S]*?FROM public\.competitions c/i,
  release_organizer_competition: /select c\.\* into v_comp[\s\S]*?from public\.competitions c/i,
};
for (const name of trancheElevenFunctions) {
  assert.ok(
    adminRpcLegacyBlock.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy issuer denial: " + name,
  );
  assert.ok(
    adminRpcBetterAuthBlock.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth positive boundary: " + name,
  );
  const definition = draft.match(
    new RegExp("CREATE OR REPLACE FUNCTION public\\." + name + "\\([\\s\\S]*?\\$function\\$;", "i"),
  )?.[0] ?? "";
  assert.ok(definition, "missing Stage 3 function: " + name);
  const issuerCheck = definition.search(/private\.current_user_is_better_auth\(\)/i);
  const firstRead = definition.search(trancheElevenFirstRead[name]);
  assert.ok(issuerCheck >= 0 && firstRead >= 0 && issuerCheck < firstRead,
    "Better Auth issuer must be checked before the first protected read: " + name);
  assert.doesNotMatch(definition, /FROM\s+(?:public\.)?user_roles\b/i,
    "function must not authorize from direct legacy user_roles: " + name);
}
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.finalize_attempt_manual[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /private\.current_user_can_edit_competition\(c\.organizer_id\)/i,
  "manual finalization must scope the attempt's initial row read to an Admin or competition editor",
);
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.get_attempt_grading_limits[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /private\.current_user_is_organizer_for\(c\.organizer_id\)/i,
  "grading limits must scope the attempt's initial row read to Admin or its organizer",
);
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.publish_competition_results[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /private\.current_user_can_edit_competition\(c\.organizer_id\)[\s\S]*?FOR UPDATE OF c/i,
  "publishing must hold the row lock only after its scoped owner/Admin predicate");
assert.match(
  draft.match(/CREATE OR REPLACE FUNCTION public\.release_organizer_competition[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /private\.current_user_is_organizer_for\(c\.organizer_id\)[\s\S]*?for update of c/i,
  "release must hold the row lock only after its scoped organizer/Admin predicate");


for (const name of trancheElevenFunctions) {
  const start = draft.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const open = draft.indexOf("$function$", start);
  const close = draft.indexOf("$function$", open + "$function$".length);
  assert.ok(start >= 0 && open > start && close > open,
    "missing complete dollar-quoted function: " + name);
  assert.equal(draft[close + "$function$".length], ";",
    "function definition must be terminated before the next CREATE: " + name);
}

const trancheElevenOrganizerStart = regression.indexOf("DO $stage7_tranche11_organizer_positive$");
const trancheElevenOrganizerEnd = regression.indexOf(
  "$stage7_tranche11_organizer_positive$;",
  trancheElevenOrganizerStart,
);
assert.ok(trancheElevenOrganizerStart >= 0 && trancheElevenOrganizerEnd > trancheElevenOrganizerStart,
  "missing positive organizer-owner runtime coverage for tranche 11");
const trancheElevenOrganizerPositive = regression.slice(
  trancheElevenOrganizerStart,
  trancheElevenOrganizerEnd,
);
for (const name of trancheElevenFunctions) {
  assert.ok(trancheElevenOrganizerPositive.includes("public." + name + "("),
    "missing organizer-positive runtime call: " + name);
}
assert.ok(trancheElevenOrganizerPositive.includes("ATTEMPT_NOT_FINALIZABLE"),
  "manual grading must reach the safe non-finalizable status guard for an authorized organizer");
assert.ok(trancheElevenOrganizerPositive.includes("STAGE3_BETTER_AUTH_ORGANIZER_RPC_SCOPE_FAILED:finalize_attempt_manual"),
  "manual grading organizer-positive probe must assert the scoped safe business boundary");
assert.ok(trancheElevenOrganizerPositive.includes("already_published"),
  "organizer result publication test must stop at its no-op already-published boundary");
assert.ok(trancheElevenOrganizerPositive.includes("COMPETITION_NOT_DRAFT"),
  "organizer release test must reach the existing non-draft validation boundary");
const trancheElevenFixtureStart = regression.indexOf(
  "-- Tranche 11 owner-scope fixture: bind the organizer when the competition is",
);
const trancheElevenFixtureEnd = regression.indexOf(
  "SELECT set_config('request.jwt.claims', '{}', TRUE);",
  trancheElevenFixtureStart,
);
assert.ok(trancheElevenFixtureStart >= 0 && trancheElevenFixtureEnd > trancheElevenFixtureStart,
  "organizer-scoped competition/attempt fixtures must be inserted after the synthetic organizer exists");
const trancheElevenFixture = regression.slice(trancheElevenFixtureStart, trancheElevenFixtureEnd);
assert.ok(trancheElevenFixture.includes("'44444444-4444-4444-8444-444444444441'"));
assert.ok(trancheElevenFixture.includes("'77777777-7777-4777-8777-777777777791'::uuid"));
assert.ok(trancheElevenFixture.includes("'55555555-5555-4555-8555-555555555561'"));
assert.ok(trancheElevenFixture.includes("'55555555-5555-4555-8555-555555555562'"));
assert.ok(trancheElevenFixture.includes("'77777777-7777-4777-8777-777777777781'"));
assert.ok(trancheElevenFixture.includes("'77777777-7777-4777-8777-777777777782'"));
const manualGradingEntitlementStart = regression.indexOf(
  "-- The organizer-owned finalize probe must pass the real manual_grading",
);
const manualGradingEntitlementEnd = regression.indexOf(
  "INSERT INTO public.questions",
  manualGradingEntitlementStart,
);
assert.ok(manualGradingEntitlementStart >= 0 &&
  manualGradingEntitlementEnd > manualGradingEntitlementStart,
  "manual-grading entitlement fixture must be set before assigning the synthetic organizer plan");
const manualGradingEntitlementFixture = regression.slice(
  manualGradingEntitlementStart,
  manualGradingEntitlementEnd,
);
assert.ok(manualGradingEntitlementFixture.includes("'manual_grading'"));
assert.ok(manualGradingEntitlementFixture.includes("STAGE7_MANUAL_GRADING_ENTITLEMENT_FIXTURE_MISSING"),
  "organizer finalize probe must have a disposable manual-grading entitlement");
assert.ok(trancheElevenFixture.includes("'Stage 7 Organizer Finalized Attempt'"));
assert.ok(trancheElevenFixture.includes("'FINALIZED'::public.attempt_status"));
assert.ok(trancheElevenFixture.includes("FALSE"),
  "organizer finalize probe must use a valid official attempt identity, not a preview with official participant IDs");
assert.doesNotMatch(
  regression.slice(
    regression.indexOf("-- Stage 7 tranche 11 organizer-owner positive tests:"),
    regression.indexOf("DO $stage7_tranche11_organizer_positive$"),
  ),
  /UPDATE public\.competitions[\s\S]*?SET organizer_id/i,
  "tranche 11 must not change immutable organizer_id after competition insert",
);


const trancheElevenOutsiderStart = regression.indexOf("DO $stage7_tranche11_unrelated_user$");
const trancheElevenOutsiderEnd = regression.indexOf(
  "$stage7_tranche11_unrelated_user$;",
  trancheElevenOutsiderStart,
);
assert.ok(trancheElevenOutsiderStart >= 0 && trancheElevenOutsiderEnd > trancheElevenOutsiderStart,
  "missing unrelated Better Auth user IDOR-denial block");
const trancheElevenOutsider = regression.slice(trancheElevenOutsiderStart, trancheElevenOutsiderEnd);
for (const name of trancheElevenFunctions) {
  assert.ok(trancheElevenOutsider.includes("public." + name + "("),
    "missing unrelated-user scope test: " + name);
  assert.ok(trancheElevenOutsider.includes("STAGE3_BETTER_AUTH_OUTSIDER_RPC_SCOPE_FAILED:" + name),
    "missing unrelated-user denial assertion: " + name);
}
assert.ok(trancheElevenOutsider.includes("'ATTEMPT_NOT_FOUND'"));
assert.ok(trancheElevenOutsider.includes("'COMPETITION_NOT_FOUND'"));
const trancheElevenOutsiderClaimsStart = regression.lastIndexOf(
  "SELECT set_config(\n  'request.jwt.claims'",
  trancheElevenOutsiderStart,
);
const trancheElevenOutsiderClaims = regression.slice(
  trancheElevenOutsiderClaimsStart,
  trancheElevenOutsiderStart,
);
assert.ok(trancheElevenOutsiderClaims.includes('"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"'),
  "IDOR test must set the distinct synthetic Better Auth student identity immediately before the outsider RPC block");

const crossBankUpdateStart = regression.indexOf("Attempt to move a question from another organizer");
const crossBankDeniedAt = regression.indexOf(
  "STAGE3_BETTER_AUTH_QUESTION_CROSS_BANK_UPDATE_ALLOWED",
  crossBankUpdateStart,
);
const crossBankAdminSwitchAt = regression.indexOf(
  "-- The unrelated/foreign bank must remain invisible to the organizer caller.",
  crossBankDeniedAt,
);
const crossBankUnchangedAt = regression.indexOf(
  "STAGE3_BETTER_AUTH_FOREIGN_QUESTION_BANK_CHANGED",
  crossBankDeniedAt,
);
assert.ok(crossBankUpdateStart >= 0 && crossBankDeniedAt > crossBankUpdateStart &&
  crossBankAdminSwitchAt > crossBankDeniedAt && crossBankUnchangedAt > crossBankAdminSwitchAt,
  "foreign question update must be attempted as organizer, then checked as Admin after denial");
const crossBankAdminSetup = regression.slice(crossBankAdminSwitchAt, crossBankUnchangedAt);
assert.ok(crossBankAdminSetup.includes('"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"'),
  "foreign question integrity check must use the existing synthetic Better Auth Admin");


const canonicalResult = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_canonical_competition_result\(p_participant_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(canonicalResult, "missing canonical direct result RPC replacement");
assert.match(canonicalResult, /SET search_path TO ''/);
assert.match(canonicalResult, /private\.current_user_is_better_auth\(\)/);
assert.match(canonicalResult, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.ok(
  canonicalResult.indexOf("private.current_user_is_better_auth()") <
    canonicalResult.indexOf("FROM public.participants"),
  "the canonical direct result RPC must validate the Better Auth issuer before its first participant read",
);
assert.match(canonicalResult, /private\.current_user_is_admin\(\)/);
assert.match(canonicalResult, /p\.user_id <> auth\.uid\(\)/);
assert.match(canonicalResult, /public\.collective_participants cp/);
assert.match(canonicalResult, /cp\.managed_by_user_id = auth\.uid\(\) OR cp\.user_id = auth\.uid\(\)/);
assert.match(canonicalResult, /RESULT_PUBLISHED.*ARCHIVED/);
assert.match(canonicalResult, /status = 'FINALIZED'[\s\S]*?is_preview = FALSE/i);
assert.match(canonicalResult, /private\.canonical_competition_rank\(p\.competition_id, p\.id\)/);

const canonicalResultPreflight = draft.match(
  /DO \$stage7_canonical_result_fingerprint_preflight\$[\s\S]*?\$stage7_canonical_result_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(canonicalResultPreflight, "missing exact canonical-result Production fingerprint preflight");
assert.match(canonicalResultPreflight, /e8523cc64cfa98e828ea8fc12902eaba/);
assert.match(canonicalResultPreflight, /e59a13014024e2878dcc5573bec0d5ef/);
assert.match(canonicalResultPreflight, /has_function_privilege\('anon'/);
assert.match(canonicalResultPreflight, /has_function_privilege\('authenticated'/);
assert.match(canonicalResultPreflight, /has_function_privilege\('service_role'/);

const myCanonicalResult = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_my_canonical_competition_result\(p_competition_id uuid\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(myCanonicalResult, "missing frontend my-result wrapper");
assert.ok(
  myCanonicalResult.indexOf("private.current_user_is_better_auth()") <
    myCanonicalResult.toLowerCase().indexOf("from public.participants"),
  "the frontend result wrapper must validate issuer before its participant lookup",
);
assert.match(myCanonicalResult, /return public\.get_canonical_competition_result\(v_pid\)/i);

for (const marker of [
  "STAGE7_TRANCHE12_LEGACY_DIRECT_RESULT_ALLOWED",
  "STAGE7_TRANCHE12_LEGACY_MY_RESULT_ALLOWED",
  "STAGE7_TRANCHE12_MY_PUBLISHED_RESULT_FAILED",
  "STAGE7_TRANCHE12_DIRECT_OWNER_RESULT_FAILED",
  "STAGE7_TRANCHE12_UNPUBLISHED_SCORE_LEAK",
  "STAGE7_TRANCHE12_CROSS_PARTICIPANT_RESULT_ALLOWED",
  "STAGE7_TRANCHE12_ADMIN_RESULT_FAILED",
  "STAGE7_TRANCHE12_COLLECTIVE_IDOR_ALLOWED",
  "STAGE7_TRANCHE12_COLLECTIVE_OWNER_RESULT_FAILED",
  "STAGE7_TRANCHE12_COLLECTIVE_CANONICAL_PARTICIPANT_MISSING",
]) {
  assert.ok(regression.includes(marker), "missing tranche 12 runtime assertion: " + marker);
}
assert.ok(regression.includes("'55555555-5555-4555-8555-555555555553'"));
assert.ok(regression.includes("'77777777-7777-4777-8777-777777777773'"));
assert.ok(regression.includes("'stage3-unpublished-result-probe'"));
assert.ok(regression.includes("'stage7-tranche12-collective-result-probe'"));
assert.ok(regression.includes("'STAGE7-T12-COL-001'"));
assert.ok(regression.includes("'66666666-6666-4666-8666-666666666682'"));
assert.ok(regression.includes("'77777777-7777-4777-8777-777777777774'"));
assert.ok(regression.includes("stage7.tranche12.canonical_participant_id"));
assert.ok(regression.includes("current_setting('stage7.tranche12.canonical_participant_id')::uuid"));


const tranche13Functions = [
  {
    name: "get_all_currency_logs",
    source: /CREATE OR REPLACE FUNCTION public\.get_all_currency_logs\(p_limit integer DEFAULT 100\)[\s\S]*?\$function\$;/i,
  },
  {
    name: "get_user_currency_logs",
    source: /CREATE OR REPLACE FUNCTION public\.get_user_currency_logs\([\s\S]*?\$function\$;/i,
  },
  {
    name: "get_active_organizer_entitlements",
    source: /CREATE OR REPLACE FUNCTION public\.get_active_organizer_entitlements\(p_organizer_id uuid\)[\s\S]*?\$function\$;/i,
  },
  {
    name: "get_organizer_effective_plan",
    source: /CREATE OR REPLACE FUNCTION public\.get_organizer_effective_plan\(p_organizer_id uuid\)[\s\S]*?\$function\$;/i,
  },
  {
    name: "get_organizer_competition_quota",
    source: /CREATE OR REPLACE FUNCTION public\.get_organizer_competition_quota\(p_organizer_id uuid\)[\s\S]*?\$function\$;/i,
  },
];
for (const item of tranche13Functions) {
  const fn = draft.match(item.source)?.[0] ?? "";
  assert.ok(fn, "missing tranche 13 replacement: " + item.name);
  assert.match(fn, /private\.current_user_is_better_auth\(\)/);
  if (item.name === "get_all_currency_logs") {
    assert.match(fn, /WHERE private\.current_user_is_better_auth\(\)[\s\S]*?private\.current_user_is_admin\(\)/i);
  } else if (item.name === "get_user_currency_logs") {
    assert.match(fn, /WHERE private\.current_user_is_better_auth\(\)[\s\S]*?l\.target_user_id = p_target_user_id[\s\S]*?p_target_user_id = \(SELECT auth\.uid\(\)\)/i);
  } else {
    const issuerIndex = fn.indexOf("private.current_user_is_better_auth()");
    const protectedReadIndex = item.name === "get_organizer_competition_quota"
      ? fn.indexOf("RETURN QUERY")
      : fn.indexOf("FROM private.get_effective_organizer_plan(");
    assert.ok(
      issuerIndex >= 0 && protectedReadIndex >= 0 && issuerIndex < protectedReadIndex,
      "tranche 13 issuer guard must precede protected entitlement/quota reads: " + item.name,
    );
  }
}

const tranche13Preflight = draft.match(
  /DO \$stage7_tranche13_fingerprint_preflight\$[\s\S]*?\$stage7_tranche13_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche13Preflight, "missing tranche 13 Production fingerprint/ACL preflight");
for (const hash of [
  "58989fc6a65d26a228f06769e444903a",
  "bf7a478554b65bffaddb761ecae34019",
  "347c3643c3860af5dca477b5a4f4f598",
  "a07ecfd264fc5401b954d1381f0fc8b5",
  "72d733e2b864c9f5171176d158f2d366",
]) assert.ok(tranche13Preflight.includes(hash), "missing tranche13 source hash " + hash);
assert.match(tranche13Preflight, /has_function_privilege\('anon'/);
assert.match(tranche13Preflight, /has_function_privilege\('authenticated'/);
assert.match(tranche13Preflight, /has_function_privilege\('service_role'/);

for (const marker of [
  "STAGE7_TRANCHE13_LEGACY_SELF_CURRENCY_LOGS_LEAKED",
  "STAGE7_TRANCHE13_LEGACY_ENTITLEMENTS_ALLOWED",
  "STAGE7_TRANCHE13_LEGACY_EFFECTIVE_PLAN_ALLOWED",
  "STAGE7_TRANCHE13_LEGACY_COMPETITION_QUOTA_ALLOWED",
  "STAGE7_TRANCHE13_ADMIN_ENTITLEMENTS_MISSING",
  "STAGE7_TRANCHE13_ORGANIZER_ENTITLEMENTS_MISSING",
  "STAGE7_TRANCHE13_FOREIGN_CURRENCY_LOGS_LEAKED",
  "STAGE7_TRANCHE13_FOREIGN_ENTITLEMENTS_ALLOWED",
  "STAGE7_TRANCHE13_FOREIGN_EFFECTIVE_PLAN_ALLOWED",
  "STAGE7_TRANCHE13_FOREIGN_COMPETITION_QUOTA_ALLOWED",
]) {
  assert.ok(regression.includes(marker), "missing tranche 13 runtime assertion: " + marker);
}
for (const functionName of [
  "get_all_currency_logs",
  "get_user_currency_logs",
  "get_active_organizer_entitlements",
  "get_organizer_effective_plan",
  "get_organizer_competition_quota",
]) {
  assert.ok(regression.includes("public." + functionName), "missing tranche 13 regression call: " + functionName);
}


const tranche14Functions = [
  { name: "get_linear_exam_activity", signature: "get_linear_exam_activity(uuid,integer,integer)" },
  { name: "grade_competition_attempt", signature: "grade_competition_attempt(uuid)" },
  { name: "grade_essay_similarity", signature: "grade_essay_similarity(uuid,uuid)" },
  { name: "save_manual_grading_item", signature: "save_manual_grading_item(uuid,numeric,text)" },
  { name: "start_organizer_exam_preview", signature: "start_organizer_exam_preview(uuid)" },
];
for (const item of tranche14Functions) {
  const fn = draft.match(new RegExp(
    "CREATE OR REPLACE FUNCTION public[.]" + item.name + "\\([\\s\\S]*?\\$function\\$;",
    "i",
  ))?.[0] ?? "";
  assert.ok(fn, "missing tranche 14 replacement: " + item.name);
  const issuerIndex = fn.indexOf("private.current_user_is_better_auth()");
  const firstReadIndex = fn.search(/\bSELECT\b/i);
  assert.ok(
    issuerIndex >= 0 && firstReadIndex >= 0 && issuerIndex < firstReadIndex,
    "tranche 14 issuer guard must precede the first protected read: " + item.name,
  );
  assert.match(fn, /BETTER_AUTH_ISSUER_REQUIRED/);
  if (item.name !== "get_linear_exam_activity") {
    const lockIndex = Math.min(
      ...["FOR UPDATE", "pg_advisory_xact_lock"].map((token) => {
        const index = fn.indexOf(token);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    if (Number.isFinite(lockIndex)) {
      const scopeIndexes = [
        fn.indexOf("private.current_user_is_admin()"),
        fn.indexOf("private.current_user_is_organizer_for("),
        fn.indexOf("private.current_user_can_edit_competition("),
        fn.indexOf("private.current_user_organizer_role("),
      ].filter((index) => index >= 0);
      assert.ok(
        scopeIndexes.length > 0 && Math.min(...scopeIndexes) < lockIndex,
        "tranche 14 owner/Admin authorization must precede protected locks: " + item.name,
      );
    }
  }
  assert.ok(
    regression.includes("public." + item.signature),
    "missing tranche 14 runtime function reference: " + item.signature,
  );
}

const previewReportStart = userRpcDraft.indexOf(
  "CREATE OR REPLACE FUNCTION public.get_organizer_exam_preview_report(",
);
const previewReportEnd = userRpcDraft.indexOf("$function$;", previewReportStart);
const previewReport = previewReportStart >= 0 && previewReportEnd > previewReportStart
  ? userRpcDraft.slice(previewReportStart, previewReportEnd + "$function$;".length)
  : "";
assert.ok(previewReport, "missing Better Auth issuer-guarded organizer preview report replacement");
assert.ok(
  userRpcDraft.includes("'public.get_organizer_exam_preview_report(uuid)'"),
  "preview report must remain inside the exact user-scoped issuer-guard set",
);
const previewIssuerAt = previewReport.indexOf("private.current_user_is_better_auth()");
const previewAttemptReadAt = previewReport.indexOf("from public.attempts");
assert.ok(previewIssuerAt >= 0 && previewAttemptReadAt > previewIssuerAt,
  "preview report must verify Better Auth before reading the preview attempt");
assert.match(previewReport, /where id = p_attempt_id and is_preview = true and preview_owner_id = v_uid/i);
assert.ok(previewReport.includes("PREVIEW_NOT_FOUND"));
assert.ok(previewReport.includes("v_runtime.phase <> 'COMPLETED'"));
assert.ok(previewReport.includes("'answer_key', q.answer_key_snapshot"));

const securityDefinerTriage = JSON.parse(readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json"),
  "utf8",
));
const previewReportAcl = securityDefinerTriage.functions.find((item) =>
  item.name === "get_organizer_exam_preview_report" && item.identityArguments === "p_attempt_id uuid"
);
assert.ok(previewReportAcl, "missing reviewed Production ACL snapshot for organizer preview report");
assert.equal(previewReportAcl.owner, "postgres");
assert.deepEqual(previewReportAcl.acl, [
  "postgres=X/postgres",
  "authenticated=X/postgres",
  "service_role=X/postgres",
]);
assert.deepEqual(previewReportAcl.execute, { anon: false, authenticated: true, serviceRole: true });
assert.deepEqual(previewReportAcl.searchPathConfig, ['search_path=""']);
for (const marker of [
  "STAGE7_TRANCHE14_OWNER_PREVIEW_REPORT_FAILED",
  "STAGE7_TRANCHE14_ADMIN_PREVIEW_REPORT_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_PREVIEW_REPORT_ALLOWED",
  "STAGE3_ANON_PARTICIPANT_DETAIL_QUESTION_SNAPSHOT_LEAKED",
]) assert.ok(regression.includes(marker), "missing owner-only preview/public snapshot runtime assertion: " + marker);

const tranche14Preflight = draft.match(
  /DO \$stage7_tranche14_fingerprint_preflight\$[\s\S]*?\$stage7_tranche14_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche14Preflight, "missing tranche 14 Production fingerprint/ACL preflight");
for (const hash of [
  "a9d641b464ace5b963f91c9d6a3d096d",
  "a04c581242d9180a7ab7bfd8dfe643d4",
  "92be45614ce3fab0a2e9aa441ca9636f",
  "65a5b9937cdd159a29dad736d996b2fc",
  "643f1d4554a7dc62a8037c2eb6d0bd08",
]) assert.ok(tranche14Preflight.includes(hash), "missing tranche 14 source fingerprint " + hash);
assert.match(tranche14Preflight, /acl\.grantee = 0/);
assert.match(tranche14Preflight, /has_function_privilege\('anon'/);
assert.match(tranche14Preflight, /has_function_privilege\('authenticated'/);
assert.match(tranche14Preflight, /has_function_privilege\('service_role'/);

for (const marker of [
  "STAGE7_TRANCHE14_LEGACY_ISSUER_ALLOWED",
  "STAGE7_TRANCHE14_OWNER_ACTIVITY_FAILED",
  "STAGE7_TRANCHE14_OWNER_GRADE_ATTEMPT_FAILED",
  "STAGE7_TRANCHE14_OWNER_AI_GRADE_SCOPE_FAILED",
  "STAGE7_TRANCHE14_OWNER_MANUAL_GRADE_SCOPE_FAILED",
  "STAGE7_TRANCHE14_OWNER_PREVIEW_SCOPE_FAILED",
  "STAGE7_TRANCHE14_ADMIN_ACTIVITY_FAILED",
  "STAGE7_TRANCHE14_ADMIN_GRADE_ATTEMPT_FAILED",
  "STAGE7_TRANCHE14_ADMIN_AI_GRADE_FAILED",
  "STAGE7_TRANCHE14_ADMIN_MANUAL_GRADE_FAILED",
  "STAGE7_TRANCHE14_ADMIN_PREVIEW_FAILED",
  "STAGE7_TRANCHE14_FOREIGN_ACTIVITY_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_GRADE_ATTEMPT_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_AI_GRADE_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_MANUAL_GRADE_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_PREVIEW_ALLOWED",
  "STAGE7_TRANCHE14_OWNER_PREVIEW_REPORT_FAILED",
  "STAGE7_TRANCHE14_ADMIN_PREVIEW_REPORT_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_PREVIEW_REPORT_ALLOWED",
  "STAGE7_TRANCHE14_ADMIN_INVESTIGATION_READ_FAILED",
  "STAGE7_TRANCHE14_ADMIN_INVESTIGATION_PREVIEW_NOT_EXCLUDED",
  "STAGE7_TRANCHE14_ADMIN_MONITORING_PREVIEW_LEAKED",
  "STAGE7_TRANCHE14_NON_ADMIN_INVESTIGATION_ALLOWED",
  "STAGE7_TRANCHE14_NON_ADMIN_MONITORING_ALLOWED",
]) assert.ok(regression.includes(marker), "missing tranche 14 runtime assertion: " + marker);

assert.match(regression, /INSERT INTO public\.grading_items[\s\S]*?Stage 7 tranche 14 rollback-only authorization fixture/);
assert.match(regression, /88888888-8888-4888-8888-888888888893/);


const tranche15Preflight = draft.match(
  /DO \$stage7_tranche15_fingerprint_preflight\$[\s\S]*?\$stage7_tranche15_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche15Preflight, "missing tranche 15 Production fingerprint/ACL preflight");
for (const hash of [
  "aa8f5302840e39728b006496ad817275",
  "ee68f31dacc8cee624c80e7a42867c56",
  "1f6215cccdc383120bbb6787e96c0f2b",
  "f2303a11f19903297554639acbd87f06",
  "860b70d16e5d204cebad55924ab8c66d",
  "79bb70032b67655f0e84d60a853fe548",
]) assert.ok(tranche15Preflight.includes(hash), "missing tranche 15 source/helper fingerprint " + hash);
assert.match(tranche15Preflight, /acl\.grantee = 0/);
assert.match(tranche15Preflight, /has_function_privilege\('anon'/);
assert.match(tranche15Preflight, /has_function_privilege\('authenticated'/);
assert.match(tranche15Preflight, /has_function_privilege\('service_role'/);

const roleHelperPreflight = issuerRestrictionDraft.match(
  /DO \$stage7_tranche15_role_helper_fingerprint_preflight\$[\s\S]*?\$stage7_tranche15_role_helper_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(roleHelperPreflight, "missing pre-replacement Production current_user_has_role fingerprint");
assert.ok(roleHelperPreflight.includes("c994079fbd7e5a56913ca1fdb8dc9666"));
assert.match(roleHelperPreflight, /'postgres'/);
assert.match(roleHelperPreflight, /search_path=public, private/);

const betterAuthRoleHelper = draft.match(
  /CREATE OR REPLACE FUNCTION private\.current_user_has_role\(p_role public\.app_role\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(betterAuthRoleHelper, "missing Stage 3 issuer-gated Admin role helper");
assert.ok(
  betterAuthRoleHelper.indexOf("private.current_user_is_better_auth()") <
    betterAuthRoleHelper.indexOf("FROM public.user_roles"),
  "Admin role helper must prove Better Auth identity before reading user_roles",
);
assert.match(betterAuthRoleHelper, /ur\.identity_origin|private\.current_user_is_better_auth/);

for (const item of [
  {name:"admin_adjust_user_currency", signature:"admin_adjust_user_currency(uuid,text,bigint,text)"},
  {name:"admin_bulk_adjust_currency", signature:"admin_bulk_adjust_currency(uuid[],text,bigint,text)"},
]) {
  const fn = draft.match(new RegExp(
    "CREATE OR REPLACE FUNCTION public[.]" + item.name + "\\([\\s\\S]*?\\$function\\$;",
    "i",
  ))?.[0] ?? "";
  assert.ok(fn, "missing Stage 3 Admin currency replacement: " + item.name);
  const guardIndex = fn.indexOf("private.current_user_is_admin()");
  const protectedReadIndex = fn.indexOf("EXECUTE format(");
  assert.ok(guardIndex >= 0 && protectedReadIndex > guardIndex,
    "Admin currency authorization must precede protected dynamic SQL: " + item.name);
  assert.doesNotMatch(fn, /FROM\s+user_roles/i,
    "Admin currency RPC must not authorize directly from legacy user_roles: " + item.name);
  assert.ok(regression.includes("public." + item.name + "("),
    "missing tranche 15 runtime call: " + item.name);
}
for (const name of [
  "admin_assign_organizer_plan",
  "admin_change_username",
  "admin_create_organizer",
]) assert.ok(regression.includes("public." + name + "("), "missing tranche 15 runtime call: " + name);

const tranche15FixturePreflight = regression.match(
  /DO \$stage7_tranche15_fixture_preflight\$[\s\S]*?\$stage7_tranche15_fixture_preflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche15FixturePreflight, "missing Tranche 15 disposable fixture preflight");
assert.match(
  tranche15FixturePreflight,
  /owner_user_id = 'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid/,
  "Tranche 15 organizer owner must be rejected if it already owns an organizer",
);

const tranche15Positive = regression.match(
  /DO \$stage7_tranche15_admin_positive\$[\s\S]*?\$stage7_tranche15_admin_positive\$;/i,
)?.[0] ?? "";
assert.ok(tranche15Positive, "missing Tranche 15 positive Admin runtime block");
assert.match(
  tranche15Positive,
  /public\.admin_create_organizer\([\s\S]*?'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid/,
  "Tranche 15 positive organizer creation must use the unclaimed synthetic owner",
);
assert.match(tranche15Positive, /STAGE7_TRANCHE15_ADMIN_OWNER_MEMBERSHIP_FAILED/);
assert.match(tranche15Positive, /member_role = 'owner'/);
assert.match(regression, /extensions\.crypt\(v_access_code, v_code_hash\)/,
  "hash verification must resolve pgcrypto through the trusted extensions schema");

for (const marker of [
  "STAGE7_TRANCHE15_LEGACY_CURRENCY_ADJUST_ALLOWED",
  "STAGE7_TRANCHE15_LEGACY_BULK_CURRENCY_ALLOWED",
  "STAGE7_TRANCHE15_LEGACY_PLAN_ASSIGN_ALLOWED",
  "STAGE7_TRANCHE15_LEGACY_USERNAME_CHANGE_ALLOWED",
  "STAGE7_TRANCHE15_LEGACY_ORGANIZER_CREATE_ALLOWED",
  "STAGE7_TRANCHE15_FOREIGN_CURRENCY_ADJUST_ALLOWED",
  "STAGE7_TRANCHE15_FOREIGN_BULK_CURRENCY_ALLOWED",
  "STAGE7_TRANCHE15_FOREIGN_PLAN_ASSIGN_ALLOWED",
  "STAGE7_TRANCHE15_FOREIGN_USERNAME_CHANGE_ALLOWED",
  "STAGE7_TRANCHE15_FOREIGN_ORGANIZER_CREATE_ALLOWED",
  "STAGE7_TRANCHE15_ADMIN_CURRENCY_ADJUST_FAILED",
  "STAGE7_TRANCHE15_ADMIN_BULK_CURRENCY_FAILED",
  "STAGE7_TRANCHE15_ADMIN_USERNAME_CHANGE_FAILED",
  "STAGE7_TRANCHE15_ADMIN_ORGANIZER_CREATE_FAILED",
  "STAGE7_TRANCHE15_ADMIN_PLAN_ASSIGN_FAILED",
  "STAGE7_TRANCHE15_ACCESS_CODE_NOT_HASH_ONLY",
]) assert.ok(regression.includes(marker), "missing tranche 15 regression assertion: " + marker);


const tranche16Preflight = draft.match(
  /DO \$stage7_tranche16_fingerprint_preflight\$[\s\S]*?\$stage7_tranche16_fingerprint_preflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche16Preflight, "missing Tranche 16 Production fingerprint/ACL preflight");
for (const hash of [
  "5ddce4c8479e0ef29315a289680c823b",
  "cb9939c070a2ae7512a72dfd2a2c4539",
  "7cc4b51d7604d7a591a6b7feccb1084a",
  "b7513a253a348990382f06cbbbf8d382",
  "248f15764ae7b4c89888407ba0031851",
]) assert.ok(tranche16Preflight.includes(hash), "missing Tranche 16 Production source fingerprint " + hash);
assert.match(tranche16Preflight, /'postgres'/);
assert.match(tranche16Preflight, /p\.prosecdef/);
assert.match(tranche16Preflight, /p\.proacl::text/);
assert.match(tranche16Preflight, /has_function_privilege\('anon'/);
assert.match(tranche16Preflight, /has_function_privilege\('authenticated'/);
assert.match(tranche16Preflight, /has_function_privilege\('service_role'/);
for (const marker of [
  "STAGE7_TRANCHE16_SOURCE_FINGERPRINT_DRIFT",
  "STAGE7_TRANCHE16_OWNER_DRIFT",
  "STAGE7_TRANCHE16_SECURITY_DEFINER_DRIFT",
  "STAGE7_TRANCHE16_SEARCH_PATH_DRIFT",
  "STAGE7_TRANCHE16_ACL_DRIFT",
  "STAGE7_TRANCHE16_RETURN_TYPE_DRIFT",
  "STAGE7_TRANCHE16_LANGUAGE_DRIFT",
  "STAGE7_TRANCHE16_EFFECTIVE_EXECUTE_DRIFT",
]) assert.ok(tranche16Preflight.includes(marker), "missing fail-closed Tranche 16 metadata diagnostic: " + marker);

const tranche16MetadataPostflight = draft.match(
  /DO \$stage7_tranche16_metadata_postflight\$[\s\S]*?\$stage7_tranche16_metadata_postflight\$;/i,
)?.[0] ?? "";
assert.ok(tranche16MetadataPostflight, "missing Tranche 16 metadata postflight");
assert.match(tranche16MetadataPostflight, /AS expected\(signature, return_type, settings, language\)/);
assert.match(tranche16MetadataPostflight, /v_language IS DISTINCT FROM v_expected\.language/);
assert.doesNotMatch(tranche16MetadataPostflight, /v_expected\.lang\b/,
  "Tranche 16 language postflight must read the exact VALUES alias, not the earlier tranche's lang field");

const tranche16Overview = draft.match(
  /CREATE OR REPLACE FUNCTION public\.get_organizer_competition_result_overview\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(tranche16Overview, "missing Tranche 16 organizer results overview replacement");
assert.ok(
  tranche16Overview.indexOf("private.current_user_is_better_auth()") >= 0 &&
  tranche16Overview.indexOf("private.current_user_is_better_auth()") < tranche16Overview.indexOf("FROM public.competitions"),
  "organizer result overview must validate Better Auth before its first competition read",
);
assert.match(tranche16Overview, /WHERE c\.id = p_competition_id[\s\S]*?private\.current_user_is_admin\(\)[\s\S]*?private\.current_user_can_edit_competition\(c\.organizer_id\)/i);
assert.match(tranche16Overview, /RAISE EXCEPTION 'COMPETITION_NOT_FOUND'/);

const tranche16List = draft.match(
  /CREATE OR REPLACE FUNCTION public\.list_organizer_registrations\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(tranche16List, "missing Tranche 16 organizer registration-list replacement");
assert.match(tranche16List, /WHERE \(SELECT private\.current_user_is_better_auth\(\)\)/);
assert.match(tranche16List, /private\.current_user_is_admin\(\)/);
assert.match(tranche16List, /private\.current_user_is_organizer_for\(p_organizer_id\)/);

const tranche16ChoosePlan = draft.match(
  /CREATE OR REPLACE FUNCTION public\.choose_organizer_plan\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(tranche16ChoosePlan, "missing Tranche 16 choose-organizer-plan replacement");
assert.ok(
  tranche16ChoosePlan.indexOf("private.current_user_is_better_auth()") >= 0 &&
  tranche16ChoosePlan.indexOf("private.current_user_is_better_auth()") < tranche16ChoosePlan.indexOf("FROM public.plan_catalog"),
  "plan selection must validate the issuer before catalog/assignment reads",
);

const tranche16Request = draft.match(
  /CREATE OR REPLACE FUNCTION public\.request_custom_organizer_plan\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(tranche16Request, "missing Tranche 16 custom-plan request replacement");
assert.ok(
  tranche16Request.indexOf("private.current_user_is_better_auth()") >= 0 &&
  tranche16Request.indexOf("private.current_user_is_better_auth()") < tranche16Request.indexOf("INSERT INTO public.organizer_custom_plan_requests"),
  "custom plan request must validate the issuer before writes",
);

const tranche16FixtureStart = regression.indexOf("-- Tranche 16 organizer registration fixture.");
const tranche16FixtureEnd = regression.indexOf(
  "SELECT set_config('request.jwt.claims', '{}', TRUE);",
  tranche16FixtureStart,
);
const tranche16RegistrationFixture = tranche16FixtureStart >= 0 && tranche16FixtureEnd > tranche16FixtureStart
  ? regression.slice(tranche16FixtureStart, tranche16FixtureEnd)
  : "";
assert.ok(tranche16RegistrationFixture, "missing Tranche 16 rollback-only registration fixture");
const fixtureTriggerDisable = tranche16RegistrationFixture.indexOf(
  "ALTER TABLE public.registrations DISABLE TRIGGER trg_validate_registration_insert;",
);
const fixtureInsert = tranche16RegistrationFixture.indexOf("INSERT INTO public.registrations (");
const fixtureTriggerEnable = tranche16RegistrationFixture.indexOf(
  "ALTER TABLE public.registrations ENABLE TRIGGER trg_validate_registration_insert;",
);
assert.ok(fixtureTriggerDisable >= 0 && fixtureTriggerDisable < fixtureInsert && fixtureTriggerEnable > fixtureInsert,
  "only the normal registration-validation trigger may be disabled around the privileged rollback fixture insert");
assert.equal(
  tranche16RegistrationFixture.split("ALTER TABLE public.registrations DISABLE TRIGGER").length - 1,
  1,
  "the fixture must not disable additional registrations triggers",
);
assert.equal(
  tranche16RegistrationFixture.split("ALTER TABLE public.registrations ENABLE TRIGGER").length - 1,
  1,
  "the fixture must restore the normal registration-validation trigger before issuer tests continue",
);

const tranche16Review = draft.match(
  /CREATE OR REPLACE FUNCTION public\.review_registration\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(tranche16Review, "missing Tranche 16 registration-review replacement");
assert.match(tranche16Review, /SELECT reg\.\* INTO r[\s\S]*?JOIN public\.competitions comp ON comp\.id = reg\.competition_id/,
  "pre-lock organizer/Admin scope check must select only the registration row into its typed row variable");
assert.doesNotMatch(tranche16Review, /SELECT reg,\s*comp INTO r,\s*c/,
  "PL/pgSQL row variables must not be used in a multi-target INTO list");
const tranche16IssuerAt = tranche16Review.indexOf("private.current_user_is_better_auth()");
const tranche16PreflightReadAt = tranche16Review.indexOf("FROM public.registrations reg");
const tranche16LockAt = tranche16Review.indexOf("FOR UPDATE");
const tranche16ScopeRecheckAt = tranche16Review.indexOf("private.current_user_is_organizer_for(c.organizer_id)", tranche16LockAt);
assert.ok(
  tranche16IssuerAt >= 0 && tranche16PreflightReadAt > tranche16IssuerAt &&
  tranche16LockAt > tranche16PreflightReadAt && tranche16ScopeRecheckAt > tranche16LockAt,
  "registration review must enforce issuer, pre-lock scope, then post-lock scope recheck",
);
assert.match(tranche16Review, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(tranche16Review, /REGISTRATION_NOT_FOUND/);

for (const marker of [
  "STAGE7_TRANCHE16_LEGACY_OVERVIEW_ALLOWED",
  "STAGE7_TRANCHE16_LEGACY_REGISTRATIONS_LEAKED",
  "STAGE7_TRANCHE16_LEGACY_REVIEW_ALLOWED",
  "STAGE7_TRANCHE16_LEGACY_PLAN_ALLOWED",
  "STAGE7_TRANCHE16_LEGACY_CUSTOM_PLAN_ALLOWED",
  "STAGE7_TRANCHE16_FOREIGN_OVERVIEW_DISCLOSED",
  "STAGE7_TRANCHE16_FOREIGN_REGISTRATIONS_LEAKED",
  "STAGE7_TRANCHE16_FOREIGN_REVIEW_DISCLOSED",
  "STAGE7_TRANCHE16_FOREIGN_PLAN_ALLOWED",
  "STAGE7_TRANCHE16_FOREIGN_CUSTOM_PLAN_ALLOWED",
  "STAGE7_TRANCHE16_OWNER_OVERVIEW_FAILED",
  "STAGE7_TRANCHE16_OWNER_REGISTRATIONS_FAILED",
  "STAGE7_TRANCHE16_OWNER_REVIEW_FAILED",
  "STAGE7_TRANCHE16_OWNER_PLAN_FAILED",
  "STAGE7_TRANCHE16_OWNER_CUSTOM_PLAN_FAILED",
  "STAGE7_TRANCHE16_ADMIN_OVERVIEW_FAILED",
  "STAGE7_TRANCHE16_ADMIN_REGISTRATIONS_FAILED",
  "STAGE7_TRANCHE16_ADMIN_REVIEW_FAILED",
  "STAGE7_TRANCHE16_ADMIN_PLAN_FAILED",
  "STAGE7_TRANCHE16_ADMIN_CUSTOM_PLAN_FAILED",
]) assert.ok(regression.includes(marker), "missing Tranche 16 runtime assertion: " + marker);

assert.ok(regression.includes("'66666666-6666-4666-8666-666666666691'"));
assert.ok(regression.includes("'Stage 7 Tranche 16 owner custom plan probe'"));
assert.match(regression, /RESET ROLE;\s*ROLLBACK;\s*$/i);

for (const marker of [
  "STAGE3_ANON_PUBLIC_RESULTS_READ_FAILED",
  "STAGE3_ANON_PUBLIC_RESULTS_PRIVATE_FIELDS_LEAKED",
  "STAGE3_ANON_UNPUBLISHED_COMPETITION_RESULTS_ALLOWED",
  "STAGE3_ANON_PRIVATE_COMPETITION_RESULTS_ALLOWED",
]) assert.ok(regression.includes(marker), "missing public competition result caller assertion: " + marker);
assert.ok(regression.includes("public.get_public_competition_results('stage3-public-result-probe', 100, 0)"));
assert.ok(regression.includes("public.get_public_competition_results('stage3-unpublished-result-probe', 100, 0)"));
assert.ok(regression.includes("public.get_public_competition_results('stage7-tranche12-collective-result-probe', 100, 0)"));

for (const marker of [
  "STAGE7_TRANSITION_COMPETITION_OWNER_FAILED",
  "STAGE7_TRANSITION_COMPETITION_OUTSIDER_NOT_DENIED",
  "STAGE7_TRANSITION_COMPETITION_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_TRANSITION_COMPETITION_ADMIN_FAILED",
]) assert.ok(regression.includes(marker), "missing transition_competition authorization assertion: " + marker);
assert.ok(regression.includes("public.transition_competition("));
assert.ok(regression.includes("'44444444-4444-4444-8444-444444444441'::uuid"));

console.log("Stage 3 SECURITY DEFINER issuer-guard contract passed: Admin, organizer owner, unrelated user and legacy issuer paths are covered in disposable runtime tests.");

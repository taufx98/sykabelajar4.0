import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql"),
  "utf8",
);
const regression = readFileSync(
  path.join(here, "./stage3-issuer-guard-regression.sql"),
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
  assert.match(definition, /private\.current_user_is_active_organizer_member\(v_org\)/,
    "organizer operations must use the issuer-gated membership helper: " + name);
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

console.log("Stage 3 SECURITY DEFINER issuer-guard contract passed: Admin and organizer RPCs use issuer-gated helpers and legacy app_users rows cannot satisfy the Admin checks.");

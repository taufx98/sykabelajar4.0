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

console.log("Stage 3 SECURITY DEFINER issuer-guard contract passed: Admin and organizer RPCs use issuer-gated helpers and legacy app_users rows cannot satisfy the Admin checks.");

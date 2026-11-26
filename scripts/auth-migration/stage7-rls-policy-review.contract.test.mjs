import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const inventory = JSON.parse(read("docs/security/AUTH-STAGE-7-RLS-NO-POLICY-INVENTORY-2026-11-21.json"));
const review = JSON.parse(read("docs/security/AUTH-STAGE-7-RLS-POLICY-REVIEW-2026-11-22.json"));
const stage5 = read("docs/security/AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql");
const regression = read("scripts/auth-migration/stage7-rls-policy-review-regression.sql");

const expected = inventory.tables
  .filter((t) => ["public", "private"].includes(t.schema))
  .map((t) => t.schema + "." + t.table)
  .sort();
const reviewed = review.tables.map((t) => t.schema + "." + t.table).sort();
assert.equal(expected.length, 23);
assert.deepEqual(reviewed, expected, "RLS review must classify each and only the 23 application tables.");
assert.equal(review.reviewed_table_count, 23);
assert.equal(review.application_table_count, 23);
assert.equal(review.status, "direct_table_acl_boundary_passed_disposable");
assert.equal(review.direct_table_boundary_acceptance.status, "passed_disposable_schema_only");
assert.equal(review.direct_table_boundary_acceptance.workflow_run_id, 45100444988);
assert.equal(review.direct_table_boundary_acceptance.commit, "feeefcfa3077adfcb6a1151cf03bb8bff75a5321");
assert.match(review.direct_table_boundary_acceptance.limitations.join(" "), /SECURITY DEFINER caller\/issuer\/token audit/);

for (const table of review.tables) {
  assert.equal(table.review_status, "direct_table_acl_boundary_passed_disposable");
  const isRetiredChatTable = [
    "chat_group_collective_reads",
    "chat_group_invites",
    "chat_group_members",
    "chat_group_reads",
    "chat_groups",
  ].includes(table.table);
  const isParticipantPortalTable = [
    "collective_portal_credentials",
    "collective_portal_identities",
    "collective_portal_sessions",
  ].includes(table.table);
  const isPrivateBetterAuthTable = [
    "organizer_free_identity_claims",
    "referral_program_settings",
    "referral_tier_awards",
  ].includes(table.table);
  const isPublicPromoBannerTable = [
    "shop_promo_banner_events",
    "shop_promo_banners",
  ].includes(table.table);
  const isServerAuthoritativeExamTable = [
    "exam_attempt_events",
    "exam_attempt_questions",
    "exam_attempt_runtime",
  ].includes(table.table);
  const expectedAuthorizationStatus = isRetiredChatTable
    ? "verified_retired_browser_access"
    : isParticipantPortalTable
      ? "verified_participant_portal_token_boundary"
      : isPrivateBetterAuthTable
        ? "verified_private_better_auth_boundary"
        : isPublicPromoBannerTable
          ? "verified_public_promo_banner_boundary"
          : table.table === "competition_status_history"
            ? "verified_competition_status_history_boundary"
            : isServerAuthoritativeExamTable
              ? "verified_server_authoritative_exam_storage"
              : "pending_security_definer_audit";
  assert.equal(
    table.authorization_path_review_status,
    expectedAuthorizationStatus,
    "authorization path state must match the reviewed table boundary: " + table.schema + "." + table.table,
  );
  assert.equal(table.owner, "postgres", table.schema + "." + table.table + " owner drift");
  assert.equal(table.rls_enabled, true, table.schema + "." + table.table + " must retain RLS");
  assert.equal(table.policy_count, 0, table.schema + "." + table.table + " must remain policy-free");
  assert.ok(table.classification, "missing boundary classification: " + table.table);
  assert.ok(table.intended_boundary.length > 40, "missing rationale: " + table.table);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, [],
    "no direct browser table privileges are expected after Stage 5: " + table.table);
  assert.ok(Array.isArray(table.source_callers), "source caller evidence missing: " + table.table);
  assert.ok(table.positive_tests.length > 0, "positive test evidence missing: " + table.table);
  assert.ok(table.negative_tests.length > 0, "negative test evidence missing: " + table.table);
}

const chatTables = review.tables.filter((table) => table.table.startsWith("chat_group"));
assert.equal(chatTables.length, 5);
assert.equal(review.authorization_path_audit_summary.verified_tables, 17);
assert.equal(review.authorization_path_audit_summary.pending_tables, 6);
assert.deepEqual(review.authorization_path_audit_summary.verified_boundaries, {
  retired_chat_browser_access: 5,
  participant_portal_token_boundary: 3,
  private_better_auth_boundary: 3,
  public_promo_banner_boundary: 2,
  competition_status_history_boundary: 1,
  server_authoritative_exam_storage: 3,
});
assert.equal(review.authorization_path_audit_summary.reviewed_at, "2026-11-26");
assert.deepEqual(review.authorization_path_audit_summary.retirement_source, {
  repository: "taufx98/sykabelajar4.0",
  ref: "main",
  path: "supabase/migrations/20261105053729_retire_chat_system.sql",
  blob_sha: "4628824aad895fa8419e49cf9b6774ab764f5592",
});
const stage3Regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
for (const table of chatTables) {
  const audit = table.authorization_path_review;
  assert.equal(table.authorization_path_review_status, "verified_retired_browser_access");
  assert.equal(audit.boundary, "retired_chat_browser_access");
  assert.equal(audit.browser_rpc_execute, "revoked_for_public_anon_authenticated");
  assert.equal(audit.direct_table_access, "revoked_for_public_anon_authenticated");
  assert.equal(audit.chat_realtime, "removed_from_supabase_realtime");
  assert.equal(audit.row_retention, "tables_and_rows_retained");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_table_acl_privileges_after_stage5_expected ?? table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  for (const caller of table.source_callers) {
    if (caller.signature === "public.admin_force_delete_competition(p_competition_id uuid, p_reason text)") {
      assert.equal(table.table, "chat_groups");
      assert.equal(caller.anon_execute, false);
      assert.equal(caller.authenticated_execute, true);
      assert.equal(caller.service_role_execute, true);
      continue;
    }
    assert.equal(caller.anon_execute, false, "retired chat caller must not expose anon EXECUTE: " + caller.signature);
    assert.equal(caller.authenticated_execute, false, "retired chat caller must not expose authenticated EXECUTE: " + caller.signature);
  }
}
const chatGroups = chatTables.find((table) => table.table === "chat_groups");
assert.deepEqual(chatGroups.authorization_path_review.exceptional_non_chat_callers, [{
  signature: "public.admin_force_delete_competition(p_competition_id uuid, p_reason text)",
  boundary: "better_auth_admin_only",
  tests: [
    "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_delete_competition",
    "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_delete_competition",
  ],
}]);
for (const marker of [
  "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_delete_competition",
  "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_delete_competition",
]) assert.ok(stage3Regression.includes(marker), "missing admin-force-delete issuer regression: " + marker);
for (const marker of [
  "STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_USAGE_REMAINS",
  "STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_USAGE_REMAINS",
  "STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_CREATE_REMAINS",
  "STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_CREATE_REMAINS",
]) assert.ok(regression.includes(marker), "missing private-schema runtime assertion: " + marker);

const portalTables = review.tables.filter((table) => table.classification === "participant_portal_token_storage");
assert.equal(portalTables.length, 3);
assert.equal(review.authorization_path_audit_summary.verified_tables, 17);
assert.equal(review.authorization_path_audit_summary.pending_tables, 6);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.retired_chat_browser_access, 5);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.public_promo_banner_boundary, 2);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.participant_portal_token_boundary, 3);
const portalInvalidRegression = read("scripts/auth-migration/stage7-collective-portal-token-regression.sql");
const portalValidRegression = read("scripts/auth-migration/stage7-collective-portal-valid-token-regression.sql");
const portalPasswordRegression = read("scripts/auth-migration/stage7-collective-portal-password-lookup-regression.sql");
const portalParentContract = read("scripts/auth-migration/stage7-collective-portal-parent-session-boundary.contract.test.mjs");
const portalPasswordContract = read("scripts/auth-migration/stage7-collective-portal-password-lookup.contract.test.mjs");
const userRpcDraft = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const expectedPortalFunctions = [
  "public.verify_collective_portal_password(p_password text)",
  "public.list_collective_portal_competitions(p_portal_token text)",
  "public.open_collective_competition_session(p_portal_token text, p_competition_id uuid, p_participant_code text)",
  "public.revoke_collective_portal_session(p_portal_token text)",
];
const expectedManagementFunctions = [
  "public.provision_collective_registration(p_registration_id uuid)",
  "public.regenerate_collective_participant_password(p_participant_id uuid)",
];
for (const table of portalTables) {
  const audit = table.authorization_path_review;
  assert.equal(table.authorization_path_review_status, "verified_participant_portal_token_boundary");
  assert.equal(audit.boundary, "anonymous_participant_portal_token");
  assert.equal(audit.direct_table_access, "revoked_for_public_anon_authenticated");
  assert.equal(audit.table_data_boundary, "service_role_only");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  for (const signature of expectedPortalFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, true, "portal bearer/password RPC must retain intended anon entry: " + signature);
    assert.equal(caller.authenticated_execute, true, "portal bearer/password RPC auth compatibility changed: " + signature);
    assert.equal(caller.security_definer, true, "portal entrypoint must remain SECURITY DEFINER: " + signature);
    assert.ok(audit.anon_entrypoints.includes(signature), "missing documented anon portal entrypoint: " + signature);
  }
  for (const signature of expectedManagementFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, false, "credential management must not be anonymous: " + signature);
    assert.equal(caller.authenticated_execute, true, "Better Auth management caller missing: " + signature);
    assert.equal(caller.security_definer, true, "credential management must retain its guarded SECURITY DEFINER wrapper: " + signature);
    assert.ok(audit.better_auth_management_entrypoints.includes(signature), "missing Better Auth management entrypoint: " + signature);
    const managementFunctionName = signature.match(/^public\.([a-z_][a-z0-9_]*)\(/)?.[1];
    assert.ok(managementFunctionName, "invalid management RPC signature: " + signature);
    const managementDefinition = userRpcDraft.match(new RegExp(
      "CREATE OR REPLACE FUNCTION public\\." + managementFunctionName + "\\([\\s\\S]*?\\$function\\$;",
      "i",
    ))?.[0] ?? "";
    assert.ok(managementDefinition, "missing guarded Stage 3 management function definition: " + signature);
    assert.ok(managementDefinition.includes("private.current_user_is_better_auth()"), "management RPC must require the Better Auth issuer: " + signature);
    assert.ok(managementDefinition.includes("BETTER_AUTH_ISSUER_REQUIRED"), "management RPC must fail closed for a legacy issuer: " + signature);
  }
  assert.ok(audit.private_helpers_require_private_schema_usage.includes("anon"));
  assert.ok(audit.private_helpers_require_private_schema_usage.includes("authenticated"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-collective-portal-token-regression.sql"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-collective-portal-valid-token-regression.sql"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-collective-portal-password-lookup-regression.sql"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-collective-portal-parent-session-boundary.contract.test.mjs"));
}
for (const marker of [
  "STAGE7_PORTAL_INVALID_PASSWORD_ACCEPTED",
  "STAGE7_PORTAL_INVALID_SESSION_OPENED",
  "STAGE7_PORTAL_INVALID_TOKEN_START_EXAM_NOT_DENIED",
  "STAGE7_PORTAL_INVALID_TOKEN_ANSWER_NOT_DENIED",
]) assert.ok(portalInvalidRegression.includes(marker), "missing invalid-token denial assertion: " + marker);
for (const marker of [
  "STAGE7_VALID_PORTAL_TOKEN_CANNOT_LIST_OWN_PRIVATE_COMPETITION",
  "STAGE7_PORTAL_TOKEN_LISTED_OTHER_PARTICIPANT",
  "STAGE7_CROSS_PARTICIPANT_EXAM_STATE_READ",
  "STAGE7_REVOKED_ACCESS_TOKEN_NOT_REJECTED",
  "STAGE7_PARENT_REVOCATION_DID_NOT_REVOKE_CHILD",
  "STAGE7_DISABLED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED",
  "STAGE7_ROTATED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED",
  "STAGE7_SUSPENDED_PORTAL_IDENTITY_CHILD_TOKEN_ALLOWED",
  "STAGE7_EXPIRED_PARENT_SESSION_CHILD_TOKEN_ALLOWED",
]) assert.ok(portalValidRegression.includes(marker), "missing valid-token isolation/revocation assertion: " + marker);
assert.ok(portalParentContract.includes("STAGE7_PARENT_REVOCATION_DID_NOT_REVOKE_CHILD"));
for (const marker of [
  "STAGE7_PORTAL_LOOKUP_5000_PASSWORD_SCALE_PROBE_FAILED",
  "STAGE7_PORTAL_LOOKUP_SAME_PREFIX_VALID_PASSWORDS_FAILED",
  "STAGE7_PORTAL_LOOKUP_WRONG_SUFFIX_NOT_COUNTED",
  "STAGE7_PORTAL_LOOKUP_ONE_ACCOUNT_LOCKOUT_AFFECTED_OTHER",
]) assert.ok(portalPasswordRegression.includes(marker), "missing password-selector/lockout assertion: " + marker);
assert.ok(portalPasswordContract.includes("64-bit account selector"));

const privateTables = review.tables.filter((table) => [
  "organizer_free_identity_claims",
  "referral_program_settings",
  "referral_tier_awards",
].includes(table.table));
assert.equal(privateTables.length, 3);
assert.equal(privateTables.every((table) => table.schema === "private"), true);
const identityRoot = read("docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql");
const provisioningRegression = read("scripts/auth-migration/stage3-better-auth-provisioning-regression.sql");
const referralSettingsMigration = read("supabase/migrations/20261101052650_referral_campaign_reward_settings.sql");
const referralAwardsMigration = read("supabase/migrations/20261101090004_referral_milestone_payouts_and_custom_promo.sql");
const referralContract = read("scripts/referral-attribution-contract.test.mjs");
const userIssuerDraft = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const earlierIssuerDraft = read("docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql");
const issuerRestrictionDraft = read("docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql");
const userIssuerContract = read("scripts/auth-migration/stage3-user-rpc-issuer-guards.contract.test.mjs");
for (const table of privateTables) {
  assert.equal(table.authorization_path_review_status, "verified_private_better_auth_boundary");
  assert.equal(table.owner, "postgres");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, []);
  assert.ok(table.authorization_path_review);
  assert.ok(table.authorization_path_review.tests.length > 0);
}
const organizerClaims = privateTables.find((table) => table.table === "organizer_free_identity_claims");
assert.equal(
  organizerClaims.authorization_path_review.caller,
  "public.create_organizer(p_name text, p_slug text)",
);
const organizerDefinition = identityRoot.match(
  /CREATE OR REPLACE FUNCTION public\.create_organizer\(p_name text, p_slug text\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(organizerDefinition);
for (const marker of [
  "https://auth-prod.sykabelajar.my.id/api/auth",
  "BETTER_AUTH_ISSUER_REQUIRED",
  /FROM\s+private\.app_users\s+au/i,
  "identity_origin",
  "BETTER_AUTH_IDENTITY_REQUIRED",
  "EMAIL_VERIFICATION_REQUIRED",
  "PHONE_VERIFICATION_REQUIRED",
  "private.organizer_free_identity_claims",
]) {
  const found = marker instanceof RegExp ? marker.test(organizerDefinition) : organizerDefinition.includes(marker);
  assert.ok(found, "create_organizer must enforce verified Better Auth identity claim: " + String(marker));
}
assert.ok(provisioningRegression.includes("public.create_organizer('Better Auth Organizer One'"));
assert.ok(provisioningRegression.includes("STAGE3_BETTER_AUTH_PHONE_REUSE_WAS_ALLOWED"));

const referralSettings = privateTables.find((table) => table.table === "referral_program_settings");
for (const signaturePrefix of [
  "public.admin_update_referral_program_settings(",
  "public.admin_update_referral_program_settings_v2(",
  "public.get_referral_program_settings()",
  "public.get_referral_program_settings_v2()",
  "public.register_for_competition(",
  "public.better_auth_provision_user(",
]) assert.ok(
  referralSettings.authorization_path_review.permitted_callers.some((signature) => signature.startsWith(signaturePrefix)),
  "missing permitted referral-settings caller: " + signaturePrefix,
);
assert.match(referralSettingsMigration, /REVOKE ALL ON TABLE private\.referral_program_settings FROM PUBLIC, anon, authenticated, service_role/);
for (const signature of [
  "public.get_referral_program_settings()",
  "public.get_referral_program_settings_v2()",
]) {
  const definition = userIssuerDraft.match(new RegExp(
    "CREATE OR REPLACE FUNCTION " + signature.replaceAll(".", "\\.") + "[\\s\\S]*?\\$function\\$;",
    "i",
  ))?.[0] ?? "";
  assert.ok(definition && definition.includes("private.current_user_is_better_auth()"),
    "referral settings read must require Better Auth issuer: " + signature);
}
const registrationDefinition = earlierIssuerDraft.match(
  /CREATE OR REPLACE FUNCTION public\.register_for_competition\([\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(registrationDefinition.includes("private.current_user_is_better_auth()"));
assert.ok(registrationDefinition.includes("BETTER_AUTH_ISSUER_REQUIRED"));
const sharedRoleHelper = issuerRestrictionDraft.match(
  /CREATE OR REPLACE FUNCTION private\.current_user_has_role\(p_role public\.app_role\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(sharedRoleHelper, "missing shared role helper issuer replacement");
for (const marker of [
  "https://auth-prod.sykabelajar.my.id/api/auth",
  "identity_origin = 'better_auth'",
  "ur.role = p_role",
  "ur.is_active = TRUE",
  "STAGE7_TRANCHE15_ROLE_HELPER_FINGERPRINT_OR_OWNER_DRIFT",
]) {
  assert.ok(
    issuerRestrictionDraft.includes(marker) || sharedRoleHelper.includes(marker),
    "shared Admin/role helper must enforce Better Auth identity: " + marker,
  );
}
assert.ok(issuerRestrictionDraft.includes("STAGE7_TRANCHE15_ROLE_HELPER_FINGERPRINT_OR_OWNER_DRIFT"));
assert.ok(referralSettingsMigration.includes("IF NOT private.current_user_is_admin()"));
assert.ok(referralContract.includes("REVOKE ALL ON TABLE private\\.referral_program_settings"));

const referralAwards = privateTables.find((table) => table.table === "referral_tier_awards");
assert.deepEqual(referralAwards.authorization_path_review.permitted_callers, [
  "public.get_my_referral_tier_awards()",
]);
assert.deepEqual(referralAwards.authorization_path_review.internal_callers, [
  "private.apply_referral_milestone_rewards(p_referrer_user_id uuid)",
  "private.capture_referral_milestone_reward() trigger on public.edu_coin_ledger",
]);
assert.match(referralAwardsMigration, /REVOKE ALL ON TABLE private\.referral_tier_awards FROM PUBLIC, anon, authenticated, service_role/);
assert.match(referralAwardsMigration, /REVOKE ALL ON FUNCTION private\.apply_referral_milestone_rewards\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(referralAwardsMigration, /CREATE TRIGGER trg_capture_referral_milestone_reward[\s\S]*?EXECUTE FUNCTION private\.capture_referral_milestone_reward\(\)/);
assert.ok(earlierIssuerDraft.includes("CREATE OR REPLACE FUNCTION public.get_my_referral_tier_awards()"));
assert.ok(userIssuerContract.includes("68 user-bound SECURITY DEFINER signatures"));
for (const marker of [
  "STAGE3_BETTER_AUTH_REFERRAL_PENDING_EVENT_MISSING",
  "STAGE3_BETTER_AUTH_REFERRAL_PROVISION_RETRY_DUPLICATED_EVENT",
  "STAGE3_BETTER_AUTH_REFERRAL_NOT_QUALIFIED_AFTER_EMAIL",
  "STAGE3_BETTER_AUTH_REFERRAL_LEDGER_NOT_IDEMPOTENT",
  "STAGE3_BETTER_AUTH_REFERRAL_DUPLICATE_REWARD",
  "STAGE3_BETTER_AUTH_PHONE_PROJECTION_INVALID",
]) assert.ok(provisioningRegression.includes(marker), "missing Better Auth referral/organizer runtime assertion: " + marker);
assert.match(identityRoot, /DROP TRIGGER IF EXISTS trg_referral_signup_attribution ON auth\.users/);
assert.match(identityRoot, /DROP TRIGGER IF EXISTS trg_referral_email_confirmed ON auth\.users/);
assert.match(identityRoot, /REVOKE ALL ON FUNCTION private\.capture_signup_referral\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
for (const marker of [
  "STAGE7_RLS_REVIEW_SERVICE_ROLE_PRIVATE_SCHEMA_USAGE_REMAINS",
  "STAGE7_RLS_REVIEW_SERVICE_ROLE_PRIVATE_SCHEMA_CREATE_REMAINS",
]) assert.ok(regression.includes(marker), "private service-role schema runtime check missing: " + marker);

const publicPromoBannerTables = review.tables.filter((table) => [
  "shop_promo_banner_events",
  "shop_promo_banners",
].includes(table.table));
assert.equal(publicPromoBannerTables.length, 2);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.public_promo_banner_boundary, 2);
const shopBannerMigration = read("supabase/migrations/20261103074001_shop_vouchers_and_carousel_banners.sql");
const shopBannerRegression = read("scripts/auth-migration/stage7-public-shop-banner-rpc-regression.sql");
const shopBannerContract = read("scripts/auth-migration/stage7-public-shop-banner-rpc.contract.test.mjs");
const issuerRestriction = read("docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql");
const publicBannerListSignature = "public.list_active_shop_promo_banners()";
const publicBannerEventSignature = "public.record_shop_promo_banner_event(p_banner_id uuid, p_event_type text, p_visitor_key text)";
const adminBannerSignatures = [
  "public.admin_list_shop_promo_banners()",
  "public.admin_save_shop_promo_banner(p_id uuid, p_image_url text, p_target_url text, p_slide_duration_seconds integer, p_position integer, p_is_active boolean)",
  "public.admin_delete_shop_promo_banner(p_id uuid)",
];
const getShopBannerDefinition = (name) => {
  const source = shopBannerMigration.toLowerCase();
  const start = source.indexOf("create or replace function public." + name.toLowerCase() + "(");
  if (start < 0) return "";
  const bodyStart = source.indexOf("as $function$", start);
  if (bodyStart < 0) return "";
  const end = source.indexOf("$function$;", bodyStart);
  return end < 0 ? "" : shopBannerMigration.slice(start, end + "$function$;".length);
};
for (const table of publicPromoBannerTables) {
  const audit = table.authorization_path_review;
  assert.equal(table.authorization_path_review_status, "verified_public_promo_banner_boundary");
  assert.equal(table.schema, "public");
  assert.equal(table.owner, "postgres");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  assert.equal(audit.boundary, "public_shop_promo_banner_access_and_event_telemetry");
  assert.equal(audit.direct_table_access, "revoked_for_public_anon_authenticated");
  assert.equal(audit.table_data_boundary, "service_role_only");
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-public-shop-banner-rpc-regression.sql"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage3-issuer-guard-regression.sql"));
}
const bannerEvents = publicPromoBannerTables.find((table) => table.table === "shop_promo_banner_events");
assert.deepEqual(bannerEvents.source_callers.map((caller) => caller.signature), [publicBannerEventSignature]);
assert.deepEqual(bannerEvents.authorization_path_review.anon_entrypoints, [publicBannerEventSignature]);
assert.deepEqual(bannerEvents.authorization_path_review.admin_entrypoints, []);
const bannerTable = publicPromoBannerTables.find((table) => table.table === "shop_promo_banners");
assert.deepEqual(bannerTable.source_callers.map((caller) => caller.signature).sort(), [
  "public.admin_delete_shop_promo_banner(p_id uuid)",
  "public.admin_list_shop_promo_banners()",
  "public.admin_save_shop_promo_banner(p_id uuid, p_image_url text, p_target_url text, p_slide_duration_seconds integer, p_position integer, p_is_active boolean)",
  publicBannerEventSignature,
  publicBannerListSignature,
].sort());
assert.deepEqual(bannerTable.authorization_path_review.anon_entrypoints, [
  publicBannerListSignature,
  publicBannerEventSignature,
]);
assert.deepEqual(bannerTable.authorization_path_review.admin_entrypoints, adminBannerSignatures);
for (const table of publicPromoBannerTables) {
  for (const caller of table.source_callers) {
    assert.equal(caller.security_definer, true, "banner caller must remain SECURITY DEFINER: " + caller.signature);
    if (caller.signature.startsWith("public.admin_")) {
      assert.equal(caller.anon_execute, false, "banner Admin RPC must not be anonymous: " + caller.signature);
      assert.equal(caller.authenticated_execute, true, "banner Admin RPC must retain authenticated EXECUTE: " + caller.signature);
      assert.equal(caller.service_role_execute, true, "trusted service role must retain banner Admin EXECUTE: " + caller.signature);
      continue;
    }
    assert.equal(caller.anon_execute, true, "public banner entrypoint must retain anon EXECUTE: " + caller.signature);
    assert.equal(caller.authenticated_execute, true, "public banner entrypoint must retain authenticated EXECUTE: " + caller.signature);
    assert.equal(caller.service_role_execute, true, "trusted service role must retain public banner EXECUTE: " + caller.signature);
  }
}
const activeBannerDefinition = getShopBannerDefinition("list_active_shop_promo_banners");
assert.ok(activeBannerDefinition);
assert.match(activeBannerDefinition, /SECURITY DEFINER/i);
assert.match(activeBannerDefinition, /SET search_path = ''/i);
assert.match(activeBannerDefinition, /WHERE b\.is_active\s*=\s*true/i);
const bannerEventDefinition = getShopBannerDefinition("record_shop_promo_banner_event");
assert.ok(bannerEventDefinition);
assert.match(bannerEventDefinition, /SECURITY DEFINER/i);
assert.match(bannerEventDefinition, /SET search_path = ''/i);
for (const marker of [
  "INVALID_BANNER_EVENT",
  "INVALID_VISITOR_KEY",
  "on conflict (banner_id,event_type,visitor_key) do nothing",
  "where b.id=p_banner_id and b.is_active=true",
  "views_count=views_count+1",
  "clicks_count=clicks_count+1",
]) assert.ok(bannerEventDefinition.includes(marker), "banner event RPC boundary is incomplete: " + marker);
for (const name of ["admin_list_shop_promo_banners","admin_save_shop_promo_banner","admin_delete_shop_promo_banner"]) {
  const definition = getShopBannerDefinition(name);
  assert.ok(definition, "missing banner Admin RPC definition: " + name);
  assert.match(definition, /private\.current_user_is_admin\(\)/i);
  assert.match(definition, /ADMIN_REQUIRED/i);
}
for (const signature of [
  "public.list_active_shop_promo_banners()",
  "public.record_shop_promo_banner_event(uuid,text,text)",
  "public.admin_list_shop_promo_banners()",
  "public.admin_save_shop_promo_banner(uuid,text,text,integer,integer,boolean)",
  "public.admin_delete_shop_promo_banner(uuid)",
]) {
  assert.ok(shopBannerMigration.includes("revoke all on function " + signature.replace(/^public\./,"public.")) ||
    shopBannerMigration.includes("revoke all on function " + signature), "missing browser ACL revocation for banner RPC: " + signature);
}
for (const name of ["admin_list_shop_promo_banners","admin_save_shop_promo_banner","admin_delete_shop_promo_banner"]) {
  assert.ok(stage3Regression.includes("STAGE3_LEGACY_ADMIN_RPC_ALLOWED:" + name),
    "missing legacy issuer denial for banner Admin RPC: " + name);
  assert.ok(stage3Regression.includes("STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:" + name),
    "missing Better Auth Admin identity assertion: " + name);
}
const sharedAdminRoleHelper = issuerRestriction.match(
  /CREATE OR REPLACE FUNCTION private\.current_user_has_role\(p_role public\.app_role\)[\s\S]*?\$function\$;/i,
)?.[0] ?? "";
assert.ok(sharedAdminRoleHelper, "missing shared Better Auth Admin role helper");
for (const marker of [
  "https://auth-prod.sykabelajar.my.id/api/auth",
  "identity_origin = 'better_auth'",
  "ur.role = p_role",
  "ur.is_active = TRUE",
]) assert.ok(sharedAdminRoleHelper.includes(marker), "Admin RPC role boundary missing Better Auth identity marker: " + marker);
for (const marker of [
  "STAGE7_BANNER_DIRECT_BROWSER_TABLE_ACCESS_REMAINS",
  "STAGE7_BANNER_ACTIVE_ONLY_LIST_FAILED",
  "STAGE7_BANNER_VALID_VIEW_NOT_RECORDED",
  "STAGE7_BANNER_DUPLICATE_VIEW_NOT_IDEMPOTENT",
  "STAGE7_BANNER_VALID_CLICK_NOT_RECORDED",
  "STAGE7_BANNER_INACTIVE_EVENT_ACCEPTED",
  "STAGE7_BANNER_MISSING_EVENT_TARGET_ACCEPTED",
  "STAGE7_BANNER_INVALID_EVENT_TYPE_ACCEPTED",
  "STAGE7_BANNER_INVALID_VISITOR_KEY_ACCEPTED",
  "STAGE7_BANNER_EVENT_LEDGER_OR_COUNTER_DRIFT",
]) assert.ok(shopBannerRegression.includes(marker), "missing public banner runtime assertion: " + marker);
assert.match(shopBannerRegression, /SET LOCAL ROLE anon[\s\S]*?list_active_shop_promo_banners[\s\S]*?record_shop_promo_banner_event/);
assert.match(shopBannerRegression, /ROLLBACK;/);
assert.ok(shopBannerContract.includes("Stage 7 public shop-promo banner RPC contract passed"));

const competitionStatusHistory = review.tables.find(
  (table) => table.schema === "public" && table.table === "competition_status_history",
);
assert.ok(competitionStatusHistory, "missing competition_status_history RLS review");
assert.equal(competitionStatusHistory.authorization_path_review_status, "verified_competition_status_history_boundary");
assert.equal(competitionStatusHistory.rls_enabled, true);
assert.equal(competitionStatusHistory.policy_count, 0);
assert.equal(competitionStatusHistory.owner, "postgres");
assert.deepEqual(competitionStatusHistory.direct_browser_privileges_after_stage5_expected, []);
assert.deepEqual(competitionStatusHistory.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
const historyAudit = competitionStatusHistory.authorization_path_review;
assert.equal(historyAudit.boundary, "better_auth_owner_admin_transition_and_public_published_result_projection");
assert.equal(historyAudit.direct_table_access, "revoked_for_public_anon_authenticated");
assert.deepEqual(competitionStatusHistory.source_callers.map((caller) => caller.signature).sort(), [
  "private.monthly_organizer_competition_quota(p_organizer_id uuid)",
  "public.admin_get_monitoring_dashboard(p_competition_id uuid, p_query text, p_status text, p_limit integer, p_offset integer)",
  "public.get_public_competition_results(p_slug text, p_limit integer, p_offset integer)",
  "public.track_competition_status()",
  "public.transition_competition(p_competition_id uuid, p_to_status competition_status, p_reason text)",
].sort());
const historyTransition = read("supabase/migrations/20261102074500_monthly_competition_publication_quota.sql")
  .match(/create or replace function public\.transition_competition\([\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.ok(historyTransition);
assert.match(historyTransition, /SECURITY DEFINER/i);
assert.match(historyTransition, /private\.current_user_is_admin\(\)/i);
assert.match(historyTransition, /private\.current_user_can_edit_competition\(v_organizer_id\)/i);
assert.match(historyTransition, /FOR UPDATE/i);
assert.match(historyTransition, /INSERT INTO public\.competition_status_history/i);
const historyDashboard = read("supabase/migrations/20261101100000_stage_6_admin_monitoring_investigations.sql")
  .match(/CREATE OR REPLACE FUNCTION public\.admin_get_monitoring_dashboard\([\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.ok(historyDashboard);
assert.match(historyDashboard, /private\.current_user_is_admin\(\)/i);
assert.match(historyDashboard, /ADMIN_REQUIRED/i);
assert.match(historyDashboard, /FROM public\.competition_status_history h/i);
const historyPublicResults = read("supabase/migrations/20261102013000_competition_public_roster_and_participant_detail.sql")
  .match(/create or replace function public\.get_public_competition_results\([\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.ok(historyPublicResults);
assert.match(historyPublicResults, /visibility = 'PUBLIC'/i);
assert.match(historyPublicResults, /status::text in \('RESULT_PUBLISHED', 'ARCHIVED'\)/i);
assert.match(historyPublicResults, /FROM public\.competition_status_history h/i);
assert.match(historyPublicResults, /'published_at'/i);
const historyTrigger = read("supabase/migrations/20261101034352_event_driven_referrals_trigger_optimization.sql");
assert.match(historyTrigger, /CREATE TRIGGER trg_competition_status_history[\s\S]*?WHEN \(OLD\.status IS DISTINCT FROM NEW\.status\)[\s\S]*?EXECUTE FUNCTION public\.track_competition_status\(\)/i);
const historyTriggerAcl = read("supabase/migrations/20260906075800_phase_13_lock_trigger_and_backend_rpcs.sql");
assert.match(historyTriggerAcl, /revoke execute on function public\.track_competition_status\(\) from public, anon, authenticated/i);
const historyIssuer = read("docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql")
  .match(/CREATE OR REPLACE FUNCTION private\.current_user_has_role\(p_role public\.app_role\)[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.ok(historyIssuer);
for (const marker of [
  "https://auth-prod.sykabelajar.my.id/api/auth",
  "identity_origin = 'better_auth'",
  "ur.role = p_role",
  "ur.is_active = TRUE",
]) assert.ok(historyIssuer.includes(marker), "Better Auth Admin role helper missing " + marker);
const historyStage3Regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
for (const marker of [
  "STAGE7_TRANSITION_COMPETITION_OWNER_FAILED",
  "STAGE7_TRANSITION_COMPETITION_OUTSIDER_NOT_DENIED",
  "STAGE7_TRANSITION_COMPETITION_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_TRANSITION_COMPETITION_ADMIN_FAILED",
  "STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_get_monitoring_dashboard",
  "STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_get_monitoring_dashboard",
  "STAGE3_ANON_PUBLIC_RESULTS_READ_FAILED",
  "STAGE3_ANON_PUBLIC_RESULTS_PRIVATE_FIELDS_LEAKED",
  "STAGE3_ANON_UNPUBLISHED_COMPETITION_RESULTS_ALLOWED",
  "STAGE3_ANON_PRIVATE_COMPETITION_RESULTS_ALLOWED",
]) assert.ok(historyStage3Regression.includes(marker), "missing competition status history caller test: " + marker);
assert.equal(review.authorization_path_audit_summary.verified_tables, 17);
assert.equal(review.authorization_path_audit_summary.pending_tables, 6);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.competition_status_history_boundary, 1);

const examTables = review.tables.filter((table) => [
  "exam_attempt_events",
  "exam_attempt_questions",
  "exam_attempt_runtime",
].includes(table.table));
assert.equal(examTables.length, 3);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.server_authoritative_exam_storage, 3);
const examRegression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
const portalExamRegression = read("scripts/auth-migration/stage7-collective-portal-valid-token-regression.sql");
const examUserRpcDraft = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const adminMonitoringMigration = read("supabase/migrations/20261101100000_stage_6_admin_monitoring_investigations.sql");
const publicParticipantMigration = read("supabase/migrations/20261102013000_competition_public_roster_and_participant_detail.sql");
const examAdminFunctions = [
  "public.admin_get_attempt_investigation(p_attempt_id uuid)",
  "public.admin_get_monitoring_dashboard(p_competition_id uuid, p_query text, p_status text, p_limit integer, p_offset integer)",
];
const examOwnerFunctions = [
  "public.get_linear_exam_activity(p_competition_id uuid, p_limit integer, p_offset integer)",
  "public.get_organizer_exam_preview_report(p_attempt_id uuid)",
  "public.grade_essay_similarity(p_attempt_id uuid, p_question_id uuid)",
  "public.save_manual_grading_item(p_grading_item_id uuid, p_score numeric, p_feedback text)",
];
const examUserFunctions = [
  "public.answer_linear_exam_question(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb, p_skip boolean)",
  "public.choose_linear_exam_timeout(p_attempt_id uuid, p_decision text)",
  "public.get_organizer_exam_preview_report(p_attempt_id uuid)",
  "public.grade_essay_similarity(p_attempt_id uuid, p_question_id uuid)",
  "public.save_linear_exam_draft(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb)",
  "public.save_manual_grading_item(p_grading_item_id uuid, p_score numeric, p_feedback text)",
  "public.skip_linear_exam_question(p_attempt_id uuid)",
  "public.start_linear_exam_attempt(p_competition_id uuid)",
];
const examPortalFunctions = [
  "public.answer_collective_linear_exam_question(p_attempt_id uuid, p_access_token text, p_question_id uuid, p_answer_json jsonb, p_skip boolean)",
  "public.choose_collective_linear_exam_timeout(p_attempt_id uuid, p_access_token text, p_decision text)",
  "public.save_collective_linear_exam_draft(p_attempt_id uuid, p_access_token text, p_question_id uuid, p_answer_json jsonb)",
  "public.skip_collective_linear_exam_question(p_attempt_id uuid, p_access_token text)",
  "public.start_collective_linear_exam_attempt(p_competition_id uuid, p_access_token text)",
];
const examInternalFunctions = [
  "private.advance_linear_exam_question(p_attempt_id uuid, p_transition_at timestamp with time zone, p_final_state text, p_time_bank_seconds integer, p_reason text, p_actor_kind text)",
  "private.build_linear_exam_state(p_attempt_id uuid)",
  "private.capture_automatic_grading_score()",
  "private.complete_linear_exam_attempt(p_attempt_id uuid, p_completed_at timestamp with time zone)",
  "private.log_linear_exam_event(p_attempt_id uuid, p_position integer, p_question_id uuid, p_event_type text, p_actor_kind text, p_metadata jsonb, p_occurred_at timestamp with time zone)",
  "private.prepare_linear_exam_runtime(p_attempt_id uuid)",
  "private.prevent_option_mutation_during_exam()",
  "private.prevent_question_mutation_during_exam()",
  "private.resolve_linear_exam_timeouts(p_attempt_id uuid, p_server_now timestamp with time zone)",
];
const examEvidence = {
  workflow: "Auth Production Schema Baseline",
  run_id: 45770807334,
  commit: "9f2acad381fb6d1f4548e29a7ed0d556574e86fd",
  successful_steps: [38,39,40,41,42,43,45,48,49,50,51,57,58,59,60,67,69],
};
for (const table of examTables) {
  const audit = table.authorization_path_review;
  assert.equal(table.authorization_path_review_status, "verified_server_authoritative_exam_storage");
  assert.equal(table.schema, "public");
  assert.equal(table.owner, "postgres");
  assert.equal(table.rls_enabled, true);
  assert.equal(table.policy_count, 0);
  assert.deepEqual(table.direct_browser_privileges_after_stage5_expected, []);
  assert.deepEqual(table.service_role_privileges, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  assert.equal(audit.boundary, "server_authoritative_exam_attempt_state");
  assert.equal(audit.direct_table_access, "revoked_for_public_anon_authenticated");
  assert.equal(audit.table_data_boundary, "service_role_only");
  assert.deepEqual(audit.private_schema_browser_usage, ["anon", "authenticated"]);
  assert.ok(audit.private_helpers.length > 0);
  assert.ok(audit.tests.includes("scripts/auth-migration/stage3-issuer-guard-regression.sql"));
  assert.ok(audit.tests.includes("scripts/auth-migration/stage7-collective-portal-valid-token-regression.sql"));
  assert.deepEqual(audit.runtime_acceptance, examEvidence);
  for (const signature of examAdminFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, false);
    assert.equal(caller.authenticated_execute, true);
    assert.equal(caller.security_definer, true);
    assert.ok(audit.admin_entrypoints.includes(signature));
  }
  for (const signature of examOwnerFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, false);
    assert.equal(caller.authenticated_execute, true);
    assert.equal(caller.security_definer, true);
    assert.ok(audit.better_auth_owner_entrypoints.includes(signature));
  }
  for (const signature of examUserFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, false);
    assert.equal(caller.authenticated_execute, true);
    assert.equal(caller.security_definer, true);
    assert.ok(examUserRpcDraft.includes("'" + signature + "'"), "missing Better Auth guarded exam RPC: " + signature);
  }
  for (const signature of examPortalFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, true);
    assert.equal(caller.authenticated_execute, true);
    assert.equal(caller.security_definer, true);
    assert.ok(audit.participant_portal_token_entrypoints.includes(signature));
  }
  for (const signature of examInternalFunctions) {
    if (!table.source_callers.some((caller) => caller.signature === signature)) continue;
    const caller = table.source_callers.find((candidate) => candidate.signature === signature);
    assert.equal(caller.anon_execute, false);
    assert.equal(caller.authenticated_execute, false);
    assert.equal(caller.service_role_execute, false);
    assert.ok(audit.private_helpers.includes(signature));
  }
}
const examEvents = examTables.find((table) => table.table === "exam_attempt_events");
assert.deepEqual(examEvents.authorization_path_review.public_projection_entrypoints, []);
const examQuestions = examTables.find((table) => table.table === "exam_attempt_questions");
assert.deepEqual(examQuestions.authorization_path_review.public_projection_entrypoints, [
  "public.get_competition_participant_detail(p_slug text, p_participant_id uuid)",
]);
const examRuntime = examTables.find((table) => table.table === "exam_attempt_runtime");
assert.deepEqual(examRuntime.authorization_path_review.public_projection_entrypoints, []);
for (const signature of examAdminFunctions) {
  const name = signature.match(/^public\.([a-z_][a-z0-9_]*)\(/)?.[1];
  assert.ok(name);
  const start = adminMonitoringMigration.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const end = adminMonitoringMigration.indexOf("$function$;", start);
  const definition = start >= 0 && end > start ? adminMonitoringMigration.slice(start, end) : "";
  assert.ok(definition.includes("private.current_user_is_admin()"));
  assert.ok(definition.includes("ADMIN_REQUIRED"));
}
const publicProjectionStart = publicParticipantMigration.indexOf("create or replace function public.get_competition_participant_detail(");
const publicProjectionEnd = publicParticipantMigration.indexOf("$function$;", publicProjectionStart);
const publicProjectionDefinition = publicProjectionStart >= 0 && publicProjectionEnd > publicProjectionStart
  ? publicParticipantMigration.slice(publicProjectionStart, publicProjectionEnd)
  : "";
assert.ok(publicProjectionDefinition);
assert.ok(publicProjectionDefinition.includes("v_comp.visibility = 'PUBLIC'"));
assert.ok(publicProjectionDefinition.includes("private.current_user_is_admin()"));
assert.ok(publicProjectionDefinition.includes("private.current_user_can_edit_competition(v_comp.organizer_id)"));
const publicProjectionResponse = publicProjectionDefinition.slice(
  publicProjectionDefinition.lastIndexOf("return jsonb_build_object("),
);
for (const key of ["'participant'", "'result'", "'question_summary'", "'awards'", "'badges'", "'certificates'"]) {
  assert.ok(publicProjectionResponse.includes(key), "public participant projection missing " + key);
}
for (const forbidden of ["'answer_key'", "'answer_key_snapshot'", "'question_snapshot'", "'accepted_answers'", "'correct_option_ids'", "'answers'"]) {
  assert.ok(!publicProjectionResponse.includes(forbidden), "public participant projection must not expose " + forbidden);
}
for (const marker of [
  "STAGE7_TRANCHE14_LEGACY_ISSUER_ALLOWED",
  "STAGE7_TRANCHE14_OWNER_ACTIVITY_FAILED",
  "STAGE7_TRANCHE14_ADMIN_ACTIVITY_FAILED",
  "STAGE7_TRANCHE14_FOREIGN_ACTIVITY_ALLOWED",
  "STAGE7_TRANCHE14_OWNER_PREVIEW_REPORT_FAILED",
  "STAGE7_TRANCHE14_ADMIN_PREVIEW_REPORT_ALLOWED",
  "STAGE7_TRANCHE14_FOREIGN_PREVIEW_REPORT_ALLOWED",
  "STAGE7_TRANCHE14_ADMIN_INVESTIGATION_READ_FAILED",
  "STAGE7_TRANCHE14_ADMIN_INVESTIGATION_PREVIEW_NOT_EXCLUDED",
  "STAGE7_TRANCHE14_ADMIN_MONITORING_PREVIEW_LEAKED",
  "STAGE7_TRANCHE14_NON_ADMIN_INVESTIGATION_ALLOWED",
  "STAGE7_TRANCHE14_NON_ADMIN_MONITORING_ALLOWED",
  "STAGE3_ANON_PARTICIPANT_DETAIL_QUESTION_SNAPSHOT_LEAKED",
]) assert.ok(examRegression.includes(marker), "missing exam caller authorization assertion: " + marker);
for (const marker of [
  "STAGE7_PORTAL_TOKEN_LISTED_OTHER_PARTICIPANT",
  "STAGE7_CROSS_PARTICIPANT_EXAM_STATE_READ",
  "STAGE7_VALID_PORTAL_TOKEN_CANNOT_LIST_OWN_PRIVATE_COMPETITION",
  "STAGE7_REVOKED_ACCESS_TOKEN_NOT_REJECTED",
]) assert.ok(portalExamRegression.includes(marker), "missing participant-token exam boundary assertion: " + marker);

const stage5Tables = [...stage5.matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
for (const name of ["competition_status_history", "notification_deliveries", "supabase_system_logs"]) {
  assert.ok(stage5.includes("public." + name), "Stage 5 ACL draft must cover " + name);
  assert.ok(regression.includes("'" + name + "'"), "RLS regression must cover " + name);
}
assert.match(stage5, /REVOKE ALL ON TABLE[\s\S]*?FROM PUBLIC, anon, authenticated;/);
assert.match(stage5, /STAGE5_ACL_POSTCONDITION_TRUSTED_ROLE_ACCESS_LOST/);

for (const table of expected) {
  const [schema, name] = table.split(".");
  assert.ok(regression.includes("('" + schema + "','" + name + "'"),
    "read-only disposable regression is missing " + table);
}
assert.match(regression, /relrowsecurity/);
assert.match(regression, /STAGE7_RLS_REVIEW_POLICY_OR_RLS_DRIFT/);
assert.match(regression, /STAGE7_RLS_REVIEW_ANON_DIRECT_GRANT_REMAINS/);
assert.match(regression, /STAGE7_RLS_REVIEW_AUTHENTICATED_DIRECT_GRANT_REMAINS/);
assert.match(regression, /STAGE7_RLS_REVIEW_SERVICE_ROLE_ACCESS_LOST/);
assert.match(regression, /TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'/);
assert.match(regression, /BEGIN READ ONLY;/);
assert.match(regression, /ROLLBACK;/);
const executableSql = regression.replace(/^--.*$/gm, "");
assert.doesNotMatch(executableSql, /\b(?:CREATE|DROP)\s+POLICY\b/i);
assert.doesNotMatch(executableSql, /\b(?:GRANT|REVOKE)\b/i);
assert.doesNotMatch(executableSql, /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i);

console.log("Stage 7 RLS review contract passed: all 23 direct table ACL boundaries are accepted on the disposable restore; SECURITY DEFINER caller authorization remains a separate gate.");

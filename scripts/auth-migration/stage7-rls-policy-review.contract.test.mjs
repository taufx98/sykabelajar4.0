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
  const expectedAuthorizationStatus = isRetiredChatTable
    ? "verified_retired_browser_access"
    : isParticipantPortalTable
      ? "verified_participant_portal_token_boundary"
      : isPrivateBetterAuthTable
        ? "verified_private_better_auth_boundary"
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
assert.equal(review.authorization_path_audit_summary.verified_tables, 11);
assert.equal(review.authorization_path_audit_summary.pending_tables, 12);
assert.deepEqual(review.authorization_path_audit_summary.verified_boundaries, {
  retired_chat_browser_access: 5,
  participant_portal_token_boundary: 3,
  private_better_auth_boundary: 3,
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
assert.equal(review.authorization_path_audit_summary.verified_tables, 11);
assert.equal(review.authorization_path_audit_summary.pending_tables, 12);
assert.equal(review.authorization_path_audit_summary.verified_boundaries.retired_chat_browser_access, 5);
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
assert.match(referralContract, /REVOKE ALL ON TABLE private\.referral_program_settings/);

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
assert.ok(userIssuerContract.includes("get_my_referral_tier_awards"));
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

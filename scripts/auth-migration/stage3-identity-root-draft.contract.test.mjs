import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql"),
  "utf8",
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql"),
  "utf8",
);
");
}

// The reviewed SQL stays outside supabase/migrations until all Stage 3 gates pass.

assert.match(draft, /ALTER TABLE private\.app_users ENABLE ROW LEVEL SECURITY/i);
assert.match(draft, /REVOKE ALL ON TABLE private\.app_users FROM PUBLIC, anon, authenticated, service_role/i);
assert.doesNotMatch(draft, /GRANT ALL ON TABLE private\.app_users TO service_role/i,
  "the Worker must call public SECURITY DEFINER RPCs and have no direct private-schema access");

const functionNames = [...draft.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9]+\.[a-z_0-9]+)/gi)]
  .map((match) => match[1].toLowerCase());
const uniqueFunctionNames = new Set(functionNames);
assert.equal(functionNames.length, 17, "identity draft must contain the reviewed 17 function definitions including the server-only phone status RPC");
assert.equal(uniqueFunctionNames.size, functionNames.length, "identity draft must not duplicate function definitions");
assert.equal(
  (draft.split("$function$;").length - 1) + (draft.split("$$;").length - 1),
  functionNames.length,
  "every SQL function definition must be terminated before the next statement",
);
for (const name of [
  "private.apply_referral_qualification",
  "private.capture_signup_referral",
  "private.process_referral_email_confirmation",
  "public.create_organizer",
  "public.get_my_referrals",
  "public.get_my_referrals_v2",
  "public.get_my_verified_referrals",
  "public.register_for_competition",
  "public.verify_pending_referrals",
  "private.provision_better_auth_user",
  "private.complete_better_auth_email_verification",
  "private.complete_better_auth_phone_verification",
  "public.better_auth_provision_user",
  "public.better_auth_complete_email_verification",
  "public.better_auth_complete_phone_verification",
  "private.get_better_auth_phone_verification_status",
  "public.better_auth_get_phone_verification_status",
]) {
  assert.equal(functionNames.filter((entry) => entry === name).length, 1,
    "function must be defined exactly once: " + name);
}
// Existing accounts are deliberately not copied into the Better Auth identity
// root. Only the separate FK planner may preserve application UUID references
// as non-authenticatable legacy_reference tombstones.
assert.doesNotMatch(
  draft,
  /^\s*(?:FROM\s+auth\.users|SELECT\b[\s\S]{0,120}FROM\s+auth\.users|INSERT\s+INTO\s+auth\.users)\b/im,
  "the SQL statements must not read from or insert old Supabase Auth accounts",
);
assert.doesNotMatch(draft, /CREATE OR REPLACE FUNCTION private\.sync_legacy_auth_user_identity_projection|CREATE TRIGGER a_sync_app_users_identity_/i);
assert.match(draft, /identity_origin text NOT NULL DEFAULT 'better_auth'/);
assert.match(draft, /identity_origin IN \('better_auth', 'legacy_reference'\)/);
assert.match(draft, /INSERT INTO private\.app_users \(id, email_verified_at, identity_origin\)[\s\S]{0,240}'better_auth'/i);
assert.match(draft, /v_identity_origin IS DISTINCT FROM 'better_auth'/i);
assert.match(draft, /LEGACY_REFERENCE_IDENTITY_CANNOT_AUTHENTICATE/);
assert.match(draft, /DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/);
assert.match(draft, /DROP TRIGGER IF EXISTS trg_referral_signup_attribution ON auth\.users/);
assert.match(draft, /DROP TRIGGER IF EXISTS trg_referral_email_confirmed ON auth\.users/);
assert.match(draft, /REVOKE ALL ON FUNCTION public\.handle_new_auth_user\(\)[\s\S]{0,160}FROM PUBLIC, anon, authenticated, service_role/);
assert.match(draft, /REVOKE ALL ON FUNCTION private\.capture_signup_referral\(\)/);
assert.match(draft, /REVOKE ALL ON FUNCTION private\.process_referral_email_confirmation\(\)/);
const fkPlanner = readFileSync(
  path.join(here, "./generate-app-users-fk-plan.mjs"),
  "utf8",
);
assert.match(fkPlanner, /00-identity-tombstones\.sql/);
assert.match(fkPlanner, /identity_origin/);
assert.match(fkPlanner, /never reads auth\.users/i);

// All Auth-dependent application reads must resolve through private.app_users.
for (const name of [
  "private.apply_referral_qualification",
  "private.capture_signup_referral",
  "public.create_organizer",
  "public.get_my_referrals",
  "public.get_my_referrals_v2",
  "public.get_my_verified_referrals",
  "public.register_for_competition",
  "public.verify_pending_referrals",
]) {
  assert.match(draft, new RegExp("CREATE OR REPLACE FUNCTION " + name.replaceAll(".", "\\.") , "i"),
    "missing migrated function " + name);
}
assert.match(draft, /FROM private\.app_users au/);
assert.doesNotMatch(draft.match(/CREATE OR REPLACE FUNCTION public\.create_organizer[\s\S]*?\$function\$;/i)?.[0] ?? "",
  /auth\.users|email_confirmed_at|phone_confirmed_at|v_user/);
assert.match(draft, /NULL::timestamptz AS last_login_at/);
assert.doesNotMatch(draft, /au\.last_sign_in_at/);

for (const name of [
  "public.get_my_referrals()",
  "public.get_my_referrals_v2()",
  "public.get_my_verified_referrals()",
]) {
  const normalized = escapeRegex(name);
  const body = draft.match(new RegExp("CREATE OR REPLACE FUNCTION " + normalized + "[\\s\\S]*?\\$function\\$;", "i"))?.[0] ?? "";
  assert.ok(body, "missing referral read function body: " + name);
  assert.match(body, /SET search_path TO ''/i,
    "SECURITY DEFINER referral RPC must use an empty search_path: " + name);
  assert.match(draft, new RegExp("REVOKE ALL ON FUNCTION " + normalized + "[\\s\\S]{0,180}FROM PUBLIC, anon, authenticated, service_role", "i"),
    "referral read RPC must revoke default/public execution: " + name);
  assert.match(draft, new RegExp("GRANT EXECUTE ON FUNCTION " + normalized + "[\\s\\S]{0,100}TO authenticated", "i"),
    "referral read RPC must be executable by authenticated only: " + name);
}
assert.doesNotMatch(draft, /GRANT EXECUTE ON FUNCTION public\.get_my_(?:verified_)?referrals(?:_v2)?\(\)[\s\S]{0,100}TO (?:PUBLIC|anon|service_role)/i);

// Registration role mapping is limited to basic roles and retries do not
// add a second role or reactivate an existing disabled role.
assert.match(draft, /UNSUPPORTED_ACCOUNT_TYPE/);
assert.match(draft, /'teacher'::public\.app_role/);
assert.match(draft, /'organizer_member'::public\.app_role/);
assert.match(draft, /where not exists \([\s\S]{0,180}existing_role\.user_id = p_user_id[\s\S]{0,100}\)/i);
assert.match(draft, /SELECT au\.identity_origin[\s\S]*FROM private\.app_users au[\s\S]*FOR UPDATE;/i);
assert.match(draft, /APPLICATION_PROFILE_NOT_READY/);
assert.match(draft, /IF v_profile_rows > 0 THEN[\s\S]{0,260}existing_role\.user_id = p_user_id/i);
assert.doesNotMatch(draft, /ON CONFLICT \(user_id, role\) DO UPDATE SET is_active = true/i);

// Private SECURITY DEFINER helpers are never directly executable by the Worker.
for (const name of [
  "private.provision_better_auth_user",
  "private.complete_better_auth_email_verification",
  "private.complete_better_auth_phone_verification",
  "private.get_better_auth_phone_verification_status",
]) {
  assert.match(draft, new RegExp("REVOKE ALL ON FUNCTION " + name.replaceAll(".", "\\.") + "[\\s\\S]{0,200}FROM PUBLIC, anon, authenticated, service_role", "i"),
    "private helper must be inaccessible to service_role: " + name);
  assert.doesNotMatch(draft, new RegExp("GRANT EXECUTE ON FUNCTION " + name.replaceAll(".", "\\.")),
    "service_role must not execute private helper directly: " + name);
}
// Only public SECURITY DEFINER wrappers are the Worker RPC surface.
for (const name of [
  "public.better_auth_provision_user",
  "public.better_auth_complete_email_verification",
  "public.better_auth_complete_phone_verification",
  "public.better_auth_get_phone_verification_status",
]) {
  assert.match(draft, new RegExp("REVOKE ALL ON FUNCTION " + name.replaceAll(".", "\\."), "i"),
    "missing PUBLIC revoke for " + name);
  assert.match(draft, new RegExp("GRANT EXECUTE ON FUNCTION " + name.replaceAll(".", "\\.") + "[\\s\\S]{0,240}TO service_role", "i"),
    "missing public RPC service_role grant for " + name);
}

assert.match(draft, /69-FK plan/i);
assert.match(draft, /does not perform the FK cutover/i);
assert.match(draft, /BEGIN;[\s\S]*COMMIT;/);
const workflow = readFileSync(
  path.join(here, "../../.github/workflows/auth-schema-baseline.yml"),
  "utf8",
);
const orderedStages = [
  "Apply Better Auth Stage 3 identity-root draft to disposable restore only",
  "Simulate all 69 FK expansion, validation and atomic cutover on disposable restore only",
  "Run Better Auth provisioning, referral, email, phone and organizer acceptance on disposable restore",
  "Run rollback-only production-shaped Stage 3 behavior and RLS regression",
  "Apply Stage 3 issuer guard to disposable restore only",
  "Run Stage 3 trusted-issuer RLS acceptance on disposable restore",
  "Simulate fail-closed 69-FK rollback on disposable restore only",
  "Simulate complete Stage 3 rollback on disposable restore only",
];
let previousIndex = -1;
for (const stage of orderedStages) {
  const currentIndex = workflow.indexOf("- name: " + stage);
  assert.ok(currentIndex > previousIndex, "baseline workflow stage order is incorrect: " + stage);
  previousIndex = currentIndex;
}
assert.match(workflow, /expected="69\\|0"/,
  "disposable forward cutover must prove 69 validated app_users FKs and zero auth.users FKs");
assert.match(workflow, /postgresql:\/\/postgres:postgres@127[.]0[.]0[.]1:54322\/postgres/,
  "identity-root and FK drafts must execute only against the disposable local database");
assert.match(workflow, /--file=\/baseline\/auth-stage3-identity-root-draft[.]sql/);
assert.match(workflow, /--file="\/plan\/\$phase"/);
assert.match(workflow, /ROLLBACK/);

console.log("Stage 3 identity-root contract passed: no legacy account backfill, UUID-only tombstones, Better Auth-only signup/verification lifecycle.");

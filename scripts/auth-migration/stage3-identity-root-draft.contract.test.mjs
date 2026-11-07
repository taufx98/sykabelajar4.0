import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql"),
  "utf8",
);

// The reviewed SQL stays outside supabase/migrations until all Stage 3 gates pass.

assert.match(draft, /ALTER TABLE private\.app_users ENABLE ROW LEVEL SECURITY/i);
assert.match(draft, /REVOKE ALL ON TABLE private\.app_users FROM PUBLIC, anon, authenticated, service_role/i);
assert.doesNotMatch(draft, /GRANT ALL ON TABLE private\.app_users TO service_role/i,
  "the Worker must call public SECURITY DEFINER RPCs and have no direct private-schema access");

const functionNames = [...draft.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9]+\.[a-z_0-9]+)/gi)]
  .map((match) => match[1].toLowerCase());
const uniqueFunctionNames = new Set(functionNames);
assert.equal(functionNames.length, 16, "identity draft must contain the reviewed 16 function definitions");
assert.equal(uniqueFunctionNames.size, functionNames.length, "identity draft must not duplicate function definitions");
assert.equal(
  (draft.split("$function$;").length - 1) + (draft.split("$$;").length - 1),
  functionNames.length,
  "every SQL function definition must be terminated before the next statement",
);
for (const name of [
  "private.sync_legacy_auth_user_identity_projection",
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
]) {
  assert.equal(functionNames.filter((entry) => entry === name).length, 1,
    "function must be defined exactly once: " + name);
}
// Only legacy Auth backfill reads the Auth table as a relation. Runtime
// function lookups must use the common identity root, not auth.users.
assert.equal((draft.match(/FROM auth\.users au/g) ?? []).length, 1);
assert.match(draft, /FROM auth\.users au\s+ON CONFLICT \(id\) DO NOTHING/);
assert.match(draft, /extensions\.digest\([\s\S]{0,240}'sha256'/);
assert.match(draft, /CREATE TRIGGER a_sync_app_users_identity_insert[\s\S]*AFTER INSERT ON auth\.users/);
assert.match(draft, /CREATE TRIGGER a_sync_app_users_identity_update[\s\S]*AFTER UPDATE OF email_confirmed_at, phone_confirmed_at, phone ON auth\.users/);
assert.ok(
  draft.includes("The a_sync name ensures") &&
  draft.includes("identity row exists before on_auth_user_created"),
  "the legacy identity sync trigger must be ordered before profile/referral Auth triggers",
);

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

// Registration role mapping is limited to basic roles and retries do not
// add a second role or reactivate an existing disabled role.
assert.match(draft, /UNSUPPORTED_ACCOUNT_TYPE/);
assert.match(draft, /'teacher'::public\.app_role/);
assert.match(draft, /'organizer_member'::public\.app_role/);
assert.match(draft, /where not exists \([\s\S]{0,180}existing_role\.user_id = p_user_id[\s\S]{0,100}\)/i);
assert.match(draft, /PERFORM 1[\s\S]*?FROM private\.app_users[\s\S]*?FOR UPDATE;/i);
assert.match(draft, /APPLICATION_PROFILE_NOT_READY/);
assert.match(draft, /IF v_profile_rows > 0 THEN[\s\S]{0,260}existing_role\.user_id = p_user_id/i);
assert.doesNotMatch(draft, /ON CONFLICT \(user_id, role\) DO UPDATE SET is_active = true/i);

// Privileged provisioning/verification is server-only.
for (const name of [
  "private.provision_better_auth_user",
  "private.complete_better_auth_email_verification",
  "private.complete_better_auth_phone_verification",
  "public.better_auth_provision_user",
  "public.better_auth_complete_email_verification",
  "public.better_auth_complete_phone_verification",
]) {
  assert.match(draft, new RegExp("REVOKE ALL ON FUNCTION " + name.replaceAll(".", "\\.") , "i"),
    "missing public revoke for " + name);
  assert.match(draft, new RegExp("GRANT EXECUTE ON FUNCTION " + name.replaceAll(".", "\\.") + "[\\s\\S]{0,240}TO service_role", "i"),
    "missing service_role grant for " + name);
}

assert.match(draft, /69-FK plan/i);
assert.match(draft, /does not perform the FK cutover/i);
assert.match(draft, /BEGIN;[\s\S]*COMMIT;/);
console.log("Stage 3 identity-root draft contract passed.");

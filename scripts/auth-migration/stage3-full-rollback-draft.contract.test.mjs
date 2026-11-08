import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.resolve(here, "../../docs/security/AUTH-STAGE-3-ROLLBACK-DRAFT.sql"), "utf8");

assert.match(sql, /DRAFT ONLY/);
assert.match(sql, /NOT A PRODUCTION MIGRATION/);
assert.match(sql, /ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS/);
assert.match(sql, /v_fk_to_auth <> 69 OR v_fk_to_app_users <> 0/);
assert.match(sql, /v_issuer_guards <> 61/);
assert.match(sql, /v_dropped <> 61/);
assert.match(sql, /better_auth_issuer_guard/);
assert.match(sql, /pol[.]polpermissive/);
assert.match(sql, /pol[.]polcmd = '\*'/);
assert.match(sql, /authenticated/);
assert.match(sql, /auth[.]sykabelajar[.]my[.]id\/api\/auth/);
assert.doesNotMatch(sql, /mvdczyitbkxkldjughor[.]supabase[.]co\\/auth\\/v1/,
  "the rollback guard must not expect the legacy issuer after fresh-account-only cutover");
assert.match(sql, /pol[.]polqual[\\s\\S]*https:\\/\\/auth[.]sykabelajar[.]my[.]id\\/api\\/auth/);
assert.match(sql, /pol[.]polwithcheck[\\s\\S]*https:\\/\\/auth[.]sykabelajar[.]my[.]id\\/api\\/auth/);
assert.match(sql, /lock_timeout/);
assert.match(sql, /statement_timeout/);

for (const name of [
  "private.apply_referral_qualification",
  "private.capture_signup_referral",
  "private.process_referral_email_confirmation",
  "public.get_my_referrals",
  "public.get_my_referrals_v2",
  "public.get_my_verified_referrals",
  "public.register_for_competition",
  "public.verify_pending_referrals",
  "public.create_organizer",
]) {
  assert.ok(sql.includes("CREATE OR REPLACE FUNCTION " + name),
    "rollback must restore the live Auth-backed function: " + name);
}
assert.match(sql, /SELECT au[.]\* INTO v_user/);
assert.match(sql, /FROM auth[.]users AS au/);
assert.match(sql, /WHERE au[.]id = v_uid/);
assert.match(sql, /RETURNING inserted_organizer[.]id INTO v_id/);

for (const trigger of ["on_auth_user_created","trg_referral_signup_attribution","trg_referral_email_confirmed"]) {
  assert.match(sql, new RegExp("CREATE TRIGGER " + trigger + "[\\s\\S]*ON auth[.]users"),
    "rollback restores the original Supabase Auth trigger: " + trigger);
}
assert.doesNotMatch(sql, /a_sync_app_users_identity|sync_legacy_auth_user_identity_projection/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public[.]handle_new_auth_user\(\) TO service_role/);
for (const wrapper of [
  "public.better_auth_provision_user",
  "public.better_auth_complete_email_verification",
  "public.better_auth_complete_phone_verification",
  "private.provision_better_auth_user",
  "private.complete_better_auth_email_verification",
  "private.complete_better_auth_phone_verification",
]) assert.ok(sql.includes("DROP FUNCTION " + wrapper), "rollback drops Stage 3 RPC: " + wrapper);

assert.match(sql, /DROP TABLE private[.]app_users/);
assert.match(sql, /v_auth_fk_count <> 69 OR v_app_users_fk_count <> 0/);
assert.match(sql, /v_auth_trigger_count <> 3 OR v_profile_trigger_count <> 4/);
assert.match(sql, /v_issuer_guard_count <> 0/);
assert.match(sql, /to_regclass\('private[.]app_users'\) IS NOT NULL/);
assert.match(sql, /COMMIT;/);

assert.doesNotMatch(sql, /DROP TABLE auth[.]users|TRUNCATE|DELETE FROM auth[.]users|DELETE FROM public[.]/i);
assert.doesNotMatch(sql, /INSERT INTO auth[.]users|UPDATE auth[.]users/i);
console.log("Stage 3 rollback contract passed: legacy Auth triggers are restored only by explicit rollback; no old account or credentials are copied.");

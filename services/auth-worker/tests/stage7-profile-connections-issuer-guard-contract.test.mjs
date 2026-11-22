import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guardSql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

function getFunction(name) {
  const marker = "CREATE OR REPLACE FUNCTION " + name;
  const start = guardSql.lastIndexOf(marker);
  assert.notEqual(start, -1, "missing function " + name);
  const end = guardSql.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing function terminator for " + name);
  return guardSql.slice(start, end + "$function$;".length);
}

const connections = getFunction("public.get_profile_connections(");
const social = getFunction("public.get_public_profile_social(");

test("private connection owner bypass requires the exact Better Auth issuer and identity row", () => {
  assert.match(connections, /SET search_path TO ''/);
  assert.match(connections, /v_uid IS NOT NULL/);
  assert.match(connections, /v_uid IS NOT DISTINCT FROM p_profile_id/);
  assert.match(connections, /auth\.jwt\(\)\s*->>\s*'iss'/);
  assert.match(connections, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);
  assert.match(connections, /private\.app_users/);
  assert.match(connections, /identity_origin = 'better_auth'/);
  assert.doesNotMatch(connections, /auth\.uid\(\)\s*<>\s*p_profile_id/);
});

test("connections reject invalid profile IDs and unsupported modes", () => {
  assert.match(connections, /p_profile_id IS NULL/);
  assert.match(connections, /p_mode IS NULL/);
  assert.match(connections, /p_mode NOT IN \('following', 'followers'\)/);
});

test("non-owners cannot read private or popup-hidden connections", () => {
  assert.match(connections, /COALESCE\(profile\.is_public, false\)/);
  assert.match(connections, /LEFT JOIN public\.profile_ui_settings/);
  assert.match(connections, /COALESCE\(settings\.show_following_popup, true\)/);
  assert.match(connections, /COALESCE\(settings\.show_social_popup, true\)/);
  assert.match(connections, /IF NOT v_profile_is_public[\s\S]*?NOT COALESCE\(v_is_better_auth_owner, false\) THEN\s+RETURN;/);
  assert.match(connections, /IF NOT COALESCE\(v_allow, true\)[\s\S]*?NOT COALESCE\(v_is_better_auth_owner, false\) THEN\s+RETURN;/);
});

test("owner access is restricted to the actual Better Auth identity, not a legacy UUID match", () => {
  assert.match(connections, /v_is_better_auth_owner :=[\s\S]*?auth\.jwt\(\)[\s\S]*?identity_origin = 'better_auth'/);
  assert.doesNotMatch(connections, /IF\s+v_uid\s*=\s*p_profile_id\s+THEN/);
});

test("the profile issuer guard changes no profile rows, policies or tables", () => {
  assert.doesNotMatch(connections, /INSERT INTO private\.app_users|UPDATE private\.app_users|DELETE FROM private\.app_users/i);
  assert.doesNotMatch(connections, /CREATE POLICY|DROP POLICY|DROP TABLE|TRUNCATE/i);
});

test("private profile badge and settings self-access require the Better Auth helper", () => {
  for (const name of [
    "public.get_public_profile_badge_visibility(",
    "public.get_public_profile_badges(",
    "public.get_public_profile_ui_settings(",
  ]) assert.match(getFunction(name), /private\.current_user_is_better_auth\(\)/);
});

test("social summary requires a Better Auth session and reserves private Admin visibility for a verified Better Auth Admin", () => {
  assert.match(social, /v_uid IS NULL OR NOT private\.current_user_is_better_auth\(\)/);
  assert.match(social, /COALESCE\(profile\.is_public, false\)/);
  assert.match(social, /v_is_better_auth_owner := v_uid IS NOT DISTINCT FROM p_profile_id/);
  assert.match(social, /v_is_better_auth_admin :=[\s\S]*private\.current_user_is_better_auth\(\)[\s\S]*AND private\.current_user_is_admin\(\)/);
  assert.match(social, /IF NOT v_is_public[\s\S]*NOT v_is_better_auth_owner[\s\S]*NOT v_is_better_auth_admin THEN\s+RETURN;/);
});

test("social summary has authenticated-only EXECUTE and exact ACL pre/post assertions", () => {
  assert.match(guardSql, /REVOKE ALL ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(guardSql, /GRANT EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+TO authenticated;/);
  assert.match(guardSql, /SOCIAL_RPC_EXECUTE_BASELINE_DRIFT/);
  assert.match(guardSql, /SOCIAL_RPC_EXECUTE_POSTFLIGHT_FAILED/);
});

test("user-specific follow RPC denies anonymous execution without removing the authenticated path", () => {
  assert.match(getFunction("public.get_follow_status("), /private\.current_user_is_better_auth\(\)/);
  assert.match(guardSql, /REVOKE EXECUTE ON FUNCTION public\.get_follow_status\(uuid, uuid\)\s+FROM PUBLIC, anon;/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guardSql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

const marker = "CREATE OR REPLACE FUNCTION public.get_profile_connections(";
const start = guardSql.lastIndexOf(marker);
assert.notEqual(start, -1, "expected the Stage 3 issuer guard draft to replace get_profile_connections");
const functionSql = guardSql.slice(start);

test("private profile connections require the exact Better Auth owner identity", () => {
  assert.match(functionSql, /SET search_path TO ''/);
  assert.match(functionSql, /v_uid IS NOT NULL/);
  assert.match(functionSql, /v_uid IS NOT DISTINCT FROM p_profile_id/);
  assert.match(functionSql, /p_mode NOT IN \\('following', 'followers'\\)/);
  assert.match(functionSql, /COALESCE\\(profile\\.is_public, false\\)/);
  assert.match(functionSql, /LEFT JOIN public\\.profile_ui_settings/);
  assert.match(functionSql, /IF NOT v_profile_is_public[\\s\\S]*?NOT COALESCE\\(v_is_better_auth_owner, false\\)/);

  assert.match(functionSql, /auth\.jwt\(\)\s*->>\s*'iss'/);
  assert.match(functionSql, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);
  assert.match(functionSql, /private\.app_users/);
  assert.match(functionSql, /identity_origin = 'better_auth'/);
  assert.doesNotMatch(functionSql, /auth\.uid\(\)\s*<>\s*p_profile_id/);
});

test("private social preferences fail closed for anon, another user, and legacy Supabase Auth", () => {
  assert.match(functionSql, /IF NOT COALESCE\(v_allow, true\)/);
  assert.match(functionSql, /AND NOT COALESCE\(v_is_better_auth_owner, false\) THEN\s+RETURN;/);
  assert.match(functionSql, /v_uid IS NOT DISTINCT FROM p_profile_id/);
  assert.match(functionSql, /identity_origin = 'better_auth'/);
});

test("public profile connections preserve the explicit profile preference", () => {
  assert.match(functionSql, /COALESCE\(s\.show_following_popup, true\)/);
  assert.match(functionSql, /COALESCE\(s\.show_social_popup, true\)/);
  assert.match(functionSql, /IF NOT COALESCE\(v_allow, true\)/);
  assert.match(functionSql, /RETURN QUERY[\s\S]*FROM public\.follows/);
});

test("the migration draft contains no profile-row rewrite or account migration", () => {
  assert.doesNotMatch(functionSql, /INSERT INTO private\.app_users|UPDATE private\.app_users|DELETE FROM private\.app_users/i);
  assert.doesNotMatch(functionSql, /CREATE POLICY|DROP POLICY|DROP TABLE/i);
});

test("all private profile self-access branches require the Better Auth identity helper", () => {
  const names = [
    "public.get_public_profile_badge_visibility(",
    "public.get_public_profile_badges(",
    "public.get_public_profile_ui_settings(",
  ];
  for (const name of names) {
    const start = guardSql.lastIndexOf("CREATE OR REPLACE FUNCTION " + name);
    assert.notEqual(start, -1, "missing issuer guard for " + name);
    const end = guardSql.indexOf("$function$;", start);
    assert.notEqual(end, -1, "missing function terminator for " + name);
    const body = guardSql.slice(start, end);
    assert.match(body, /private\.current_user_is_better_auth\(\)/);
  }
});

test("login-only social RPCs require a Better Auth session and have browser EXECUTE removed", () => {
  for (const name of [
    "public.get_follow_status(",
    "public.get_public_profile_social(",
  ]) {
    const start = guardSql.lastIndexOf("CREATE OR REPLACE FUNCTION " + name);
    assert.notEqual(start, -1, "missing issuer guard for " + name);
    const end = guardSql.indexOf("$function$;", start);
    const body = guardSql.slice(start, end);
    assert.match(body, /private\.current_user_is_better_auth\(\)/);
    assert.match(body, /BETTER_AUTH_ISSUER_REQUIRED/);
  }
  assert.match(guardSql, /REVOKE EXECUTE ON FUNCTION public\.get_follow_status\(uuid, uuid\)\s+FROM PUBLIC, anon;/);
  assert.match(guardSql, /REVOKE EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon;/);
});

test("public connection lists require both public profile visibility and popup visibility", () => {
  assert.match(functionSql, /IF NOT v_profile_is_public[\s\S]*?NOT COALESCE\(v_is_better_auth_owner, false\) THEN\s+RETURN;/);
  assert.match(functionSql, /IF NOT COALESCE\(v_allow, true\)[\s\S]*?NOT COALESCE\(v_is_better_auth_owner, false\) THEN\s+RETURN;/);
  assert.match(functionSql, /p_mode NOT IN \('following', 'followers'\)/);
});

test("get_public_profile_social hides private social aggregates from non-owners", () => {
  const start = guardSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.get_public_profile_social(");
  assert.notEqual(start, -1);
  const end = guardSql.indexOf("$function$;", start);
  const body = guardSql.slice(start, end);
  assert.match(body, /private\.current_user_is_better_auth\(\)/);
  assert.match(body, /COALESCE\(profile\.is_public, false\)/);
  assert.match(body, /IF NOT v_is_public AND v_uid IS DISTINCT FROM p_profile_id THEN\s+RETURN;/);
});

test("social-summary ACL is authenticated-only and does not rely on default PUBLIC grants", () => {
  assert.match(guardSql, /REVOKE ALL ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(guardSql, /GRANT EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+TO authenticated;/);
  assert.match(guardSql, /SOCIAL_RPC_EXECUTE_BASELINE_DRIFT/);
  assert.match(guardSql, /SOCIAL_RPC_EXECUTE_POSTFLIGHT_FAILED/);
});

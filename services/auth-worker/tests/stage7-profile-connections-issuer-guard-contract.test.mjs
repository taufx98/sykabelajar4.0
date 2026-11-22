import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guardSql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

function functionBody(signature) {
  const marker = "CREATE OR REPLACE FUNCTION " + signature;
  const start = guardSql.lastIndexOf(marker);
  assert.notEqual(start, -1, "missing guarded function " + signature);
  const end = guardSql.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing function terminator " + signature);
  return guardSql.slice(start, end);
}

test("private profile connections require the Better Auth owner identity", () => {
  const body = functionBody("public.get_profile_connections(");
  assert.match(body, /SET search_path TO ''/);
  assert.match(body, /v_uid IS NOT DISTINCT FROM p_profile_id/);
  assert.match(body, /private\.current_user_is_better_auth\(\)/);
  assert.match(body, /identity_origin = 'better_auth'/);
  assert.doesNotMatch(body, /auth\.uid\(\)\s*<>\s*p_profile_id/);
});

test("anonymous and non-owner viewers cannot access private profile connections", () => {
  const body = functionBody("public.get_profile_connections(");
  assert.match(body, /v_profile_is_public boolean/);
  assert.match(body, /COALESCE\(pr\.is_public, false\)/);
  assert.match(body, /NOT COALESCE\(v_profile_is_public, false\)/);
  assert.match(body, /NOT COALESCE\(v_allow, true\)/);
  assert.match(body, /IF NOT COALESCE\(v_is_better_auth_owner, false\)/);
  assert.match(body, /THEN\s+RETURN;/);
});

test("public profile connections still respect per-section preferences", () => {
  const body = functionBody("public.get_profile_connections(");
  assert.match(body, /COALESCE\(s\.show_following_popup, true\)/);
  assert.match(body, /COALESCE\(s\.show_social_popup, true\)/);
  assert.match(body, /v_profile_is_public/);
  assert.match(body, /RETURN QUERY[\s\S]*FROM public\.follows/);
});

test("private profile badge and settings access require a Better Auth identity", () => {
  for (const signature of [
    "public.get_public_profile_badge_visibility(",
    "public.get_public_profile_badges(",
    "public.get_public_profile_ui_settings(",
  ]) {
    const body = functionBody(signature);
    assert.match(body, /private\.current_user_is_better_auth\(\)/);
  }
  for (const signature of [
    "public.get_public_profile_badge_visibility(",
    "public.get_public_profile_badges(",
  ]) {
    const body = functionBody(signature);
    assert.match(body, /private\.current_user_is_admin\(\)/);
    assert.match(body, /private\.current_user_is_better_auth\(\)[\s\S]*?private\.current_user_is_admin\(\)/);
  }
});

test("social summaries require a Better Auth viewer and respect target profile visibility", () => {
  const body = functionBody("public.get_public_profile_social(");
  assert.match(body, /private\.current_user_is_better_auth\(\)/);
  assert.match(body, /BETTER_AUTH_ISSUER_REQUIRED/);
  assert.match(body, /COALESCE\(p\.is_public, true\)/);
  assert.match(body, /v_is_better_auth_owner/);
  assert.match(body, /v_is_better_auth_admin/);
  assert.match(body, /NOT COALESCE\(v_profile_is_public, false\)/);
  assert.doesNotMatch(body, /show_social_popup/);
  assert.match(body, /IF NOT v_is_better_auth_owner/);
  assert.match(body, /IF NOT FOUND THEN\s+RETURN;/);
});

test("login-only social RPCs have browser EXECUTE removed", () => {
  assert.match(guardSql, /REVOKE EXECUTE ON FUNCTION public\.get_follow_status\(uuid, uuid\)\s+FROM PUBLIC, anon;/);
  assert.match(guardSql, /REVOKE EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon;/);
});

test("the issuer draft does not migrate, rewrite or delete profile rows", () => {
  const executable = guardSql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(executable, /INSERT INTO private\.app_users|UPDATE private\.app_users|DELETE FROM private\.app_users/i);
  assert.doesNotMatch(executable, /CREATE POLICY|DROP POLICY|DROP TABLE/i);
});

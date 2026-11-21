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

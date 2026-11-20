import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.resolve(here, "../../docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql"), "utf8");

test("Production first-admin draft is pinned to the expected owner-controlled target", () => {
  assert.match(sql, /DRAFT ONLY/);
  assert.match(sql, /mvdczyitbkxkldjughor/);
  assert.match(sql, /current_user <> 'postgres'/);
  assert.match(sql, /sykabelajar-auth-production-first-admin/);
  assert.match(sql, /00000000-0000-0000-0000-000000000000/);
});

test("Production first-admin requires an existing verified Better Auth projection", () => {
  assert.match(sql, /private[.]app_users/);
  assert.match(sql, /identity_origin = 'better_auth'/);
  assert.match(sql, /email_verified_at IS NULL/);
  assert.match(sql, /email_verified_at IS NOT NULL/);
  assert.match(sql, /auth[.]users WHERE id = v_user_id/);
  assert.match(sql, /PRODUCTION_FIRST_ADMIN_SHADOW_AUTH_USER_NOT_ALLOWED/);
  assert.doesNotMatch(sql, /UPDATE\s+private[.]app_users\s+SET\s+email_verified_at/i);
  assert.doesNotMatch(sql, /\b(?:SELECT|PERFORM)\s+public\.better_auth_provision_user\s*\(/i);
});

test("Production first-admin requires completed 69-FK and issuer cutover", () => {
  assert.match(sql, /v_fk_to_app_users <> 69 OR v_fk_to_auth_users <> 0/);
  assert.match(sql, /v_issuer_guard_rows <> 61/);
  assert.match(sql, /auth-prod[.]sykabelajar[.]my[.]id\/api\/auth/);
});

test("Production first-admin excludes legacy Admin rows from its one-time Better Auth check", () => {
  assert.match(sql, /JOIN private[.]app_users au ON au[.]id = ur[.]user_id/);
  assert.match(sql, /au[.]identity_origin = 'better_auth'/);
  assert.match(sql, /PRODUCTION_FIRST_BETTER_AUTH_ADMIN_ALREADY_BOOTSTRAPPED/);
  assert.match(sql, /Existing legacy admins are deliberately excluded and preserved/);
  assert.match(sql, /INSERT INTO public[.]user_roles \(user_id, role, is_active\)/);
  assert.doesNotMatch(sql, /UPDATE\s+public[.]user_roles|DELETE\s+FROM\s+public[.]user_roles/i);
});

test("Production first-admin performs no legacy identity or application data rewrite", () => {
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+auth[.]users|UPDATE\s+auth[.]users|DELETE\s+FROM\s+auth[.]users/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public[.]|TRUNCATE\s+/i);
  assert.doesNotMatch(sql, /UPDATE\s+private[.]app_users/i);
  assert.match(sql, /COMMIT;/);
});

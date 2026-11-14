import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql", import.meta.url),
  "utf8",
);
const runbook = readFileSync(
  new URL("../../../docs/security/AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.md", import.meta.url),
  "utf8",
);

test("first-admin SQL is an owner-operated staging-only procedure, not a public migration", () => {
  assert.match(sql, /MANUAL, STAGING-ONLY FIRST ADMIN BOOTSTRAP/);
  assert.match(sql, /ydamszdfsxqisanazdkb/);
  assert.match(sql, /current_user <> 'postgres'/);
  assert.match(sql, /REPLACE_WITH_VERIFIED_BETTER_AUTH_UUID/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED/);
  assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY|service_role key|wrangler secret/i);
});

test("bootstrap only accepts an externally verified Better Auth identity and blocks legacy/shadow identities", () => {
  assert.match(sql, /user\.emailVerified=true/);
  assert.match(sql, /identity_origin <> 'better_auth'/);
  assert.match(sql, /FROM auth\.users WHERE id = v_user_id/);
  assert.match(sql, /p_email_verified\s*=>?\s*TRUE|TRUE,/);
  assert.match(runbook, /api\/auth\/get-session/);
  assert.match(runbook, /user\.emailVerified: true/);
  assert.match(runbook, /Never copy a session cookie, access token, or client secret/);
});

test("public registration remains unable to request admin and owner bootstrap grants only one active admin", () => {
  assert.match(sql, /'student'/);
  assert.match(sql, /'admin'::public\.app_role/);
  assert.match(sql, /role = 'admin'::public\.app_role/);
  assert.match(sql, /is_active = TRUE/);
  assert.match(runbook, /does not allow public registration to request the `admin` role/);
  assert.match(runbook, /Never use the SQL file against production/);
});

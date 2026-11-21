import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/auth-cloudflare-production-provisioning-enable.yml", import.meta.url),
  "utf8",
);

test("Production provisioning activation is manual, owner-only, and exact-target gated", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /ENABLE-PRODUCTION-PROVISIONING-sykabelajar-auth-prod-DB2-IDENTITY-ROOT-SENDPULSE/);
  assert.match(workflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(workflow, /mvdczyitbkxkldjughor/);
});

test("Production provisioning activation requires off-GitHub backup and complete definer audit", () => {
  assert.match(workflow, /PRODUCTION_DB2_BACKUP_SHA256/);
  assert.match(workflow, /\{64\}/);
  assert.match(workflow, /AUTH-STAGE-7-SECURITY-DEFINER-ALLOWLIST-2026-11-21\.json/);
  assert.match(workflow, /authenticatedSecurityDefinerCount !== 202/);
  assert.match(workflow, /anonSecurityDefinerCount !== 46/);
  assert.match(workflow, /reviewedAuthenticatedFunctionCount !== 202/);
  assert.match(workflow, /functions\.length !== 202/);
});

test("Only the server-only Production provisioning binding is accepted", () => {
  assert.match(workflow, /SUPABASE_PROVISIONING_API_KEY/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /DB2/);
  assert.match(workflow, /service_role/);
  assert.match(workflow, /AUTH_SIGNUP_DISABLED/);
  assert.match(workflow, /SUPABASE_PROVISIONING_ENABLED = "true"/);
  assert.match(workflow, /AUTH_SIGNUP_DISABLED = "true"/);
});

test("Stage 3 identity-root and 69-FK preconditions are read-only verified before deployment", () => {
  assert.match(workflow, /private\.app_users/);
  assert.match(workflow, /better_auth_provision_user/);
  assert.match(workflow, /better_auth_complete_email_verification/);
  assert.match(workflow, /APP_USERS_FKS.*69/);
  assert.match(workflow, /USER_TRIGGERS.*0/);
  assert.match(workflow, /to_regprocedure/);
  assert.match(workflow, /auth\.users/);
  assert.match(workflow, /legacy_reference/);
});

test("SendPulse is the only active provider prerequisite and identity state stays empty", () => {
  assert.match(workflow, /provider='sendpulse'/);
  assert.match(workflow, /active_sendpulse/);
  assert.match(workflow, /email_verification_required/);
  assert.match(workflow, /production_email_bootstrap/);
  assert.match(workflow, /first_account_marker/);
  assert.match(workflow, /users.*accounts.*sessions/);
});

test("Deployment changes only the Production provisioning flag and preserves staging", () => {
  assert.match(workflow, /SUPABASE_PROVISIONING_ENABLED = "false"/);
  assert.match(workflow, /SUPABASE_PROVISIONING_ENABLED = "true"/);
  assert.match(workflow, /replace\('SUPABASE_PROVISIONING_ENABLED = "true"',match\)===original/);
  assert.match(workflow, /deploy --dry-run/);
  assert.match(workflow, /AUTH_SIGNUP_DISABLED.*true/);
  assert.match(workflow, /auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(workflow, /signup\.status,503/);
  assert.match(workflow, /no Better Auth identity\/session\/provider state was altered/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/auth-worker-staging-deploy.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");
const wranglerConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("staging Worker deploy has one exact guarded push marker and manual fallback", () => {
  assert.match(workflow, /^on:\n  push:/m);
  assert.match(workflow, /branches:\n      - security\/auth-poc-stage-1/);
  assert.match(workflow, /paths:\n      - "\.github\/auth-ops\/DEPLOY-STAGING-WORKER-0013"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*push/);
  assert.match(workflow, /DEPLOY-STAGING-WORKER-0013/);
  assert.match(workflow, /DEPLOY-STAGING-WORKER-sykabelajar-auth-poc/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
});

test("staging deployment is hard-bound to the reviewed Worker, D1, and hostname", () => {
  assert.match(workflow, /name = "sykabelajar-auth-poc"/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(workflow, /auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /DEV_APP_ORIGIN/);
  assert.match(wranglerConfig, /^DEV_APP_ORIGIN = "https:\/\/staging\.sykabelajar\.my\.id"$/m);
  assert.match(wranglerConfig, /^OAUTH_CALLBACK_URL = "https:\/\/staging\.sykabelajar\.my\.id\/auth\/oidc\/callback"$/m);
  assert.match(workflow, /same-site staging callback\/domain/);
  assert.doesNotMatch(wranglerConfig, /^DEV_APP_ORIGIN = "https:\/\/\*\./m);
  assert.match(workflow, /workers_dev = false/);
  assert.match(workflow, /custom_domain = true/);
  assert.match(workflow, /pragma_table_info\('user'\)/);
  const requiredProfileColumns = [
    "accountType", "username", "referralCode",
    "birthDate", "institution", "grade", "subjects",
  ];
  for (const column of requiredProfileColumns) {
    assert.match(workflow, new RegExp("'" + column + "'"));
    assert.match(workflow, new RegExp('"' + column + '"'));
  }
  assert.match(workflow, /Run the guarded D1 migration workflow first/);
  assert.match(workflow, /SUPABASE_URL.*mvdczyitbkxkldjughor/);
  assert.match(wranglerConfig, /^SUPABASE_PROVISIONING_URL = "https:\/\/ydamszdfsxqisanazdkb\.supabase\.co"$/m);
  assert.match(wranglerConfig, /^SUPABASE_PROVISIONING_PUBLISHABLE_KEY = "sb_publishable_4GjRAXld9GnxYf2pJBPrTQ_Pqh_QI4v"$/m);
  assert.match(wranglerConfig, /^SUPABASE_PROVISIONING_ENABLED = "(?:true|false)"$/m);
  assert.match(workflow, /const provisioningEnabled = \/\^SUPABASE_PROVISIONING_ENABLED/);
  assert.match(workflow, /if \(provisioningEnabled && !provisioningSecretReady\)/);
  const keyGuardIndex = workflow.indexOf("Ensure dedicated OAuth-provider encryption key exists without rotating");
  const deployIndex = workflow.indexOf("Deploy only the isolated Better Auth staging Worker");
  assert.ok(keyGuardIndex >= 0 && deployIndex > keyGuardIndex,
    "required Worker secret bindings must be checked before the Worker is deployed");
  assert.match(workflow, /SUPABASE_PROVISIONING_ENABLED/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /SUPABASE_PROVISIONING_API_KEY/);
  assert.match(workflow, /exactly one server-only Supabase staging API key binding is required/);
  assert.match(wranglerConfig, /^AUTH_EMAIL_PROVIDER = "managed"$/m);
  assert.match(workflow, /auth_email_accounts/);
  assert.match(workflow, /auth-worker-staging-email-provider.json/);
  assert.match(workflow, /Transactional email provider migration 0006 is missing/);
  assert.match(workflow, /expected\.length !== 21/);
  assert.match(workflow, /auth_phone_verification_challenges/);
  assert.match(workflow, /auth_social_provider_settings/);
  assert.match(workflow, /auth_social_provider_meta/);
  assert.match(workflow, /auth_runtime_settings/);
  assert.match(workflow, /auth_runtime_settings_rows/);
  assert.match(workflow, /social_provider_meta/);
  assert.match(workflow, /phone_challenges/);
  assert.match(workflow, /active_sessions_for_unverified_users/);
  assert.match(workflow, /no unverified user has an active session/);
  assert.match(workflow, /existing staging identity state without exposing user data/);
  assert.doesNotMatch(workflow, /Staging D1 unexpectedly contains .* rows; refusing deployment/);
  assert.match(workflow, /emailVerificationConfigured/);
  assert.match(workflow, /\["emailVerificationConfigured", "issuer", "ok", "providers"\]/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\./i,
    "the service-role key value must remain a Worker secret and must never be injected into the Actions runner");
  assert.doesNotMatch(workflow, /wrangler\s+d1\s+(delete|create)/i);
});

test("Wrangler deploy command uses only supported arguments", () => {
  const deployStep = workflow.split("      - name: Deploy only the isolated Better Auth staging Worker")[1]
    ?.split("      - name: Verify hosted health")[0];
  assert.ok(deployStep, "deploy step should exist");
  assert.match(deployStep, /npx wrangler deploy/);
  assert.doesNotMatch(deployStep, /--secrets-file/);
  assert.match(deployStep, /--var "SUPABASE_URL:/);
  assert.match(deployStep, /--var "SUPABASE_PUBLISHABLE_KEY:/);
  assert.match(deployStep, /--message/);
  assert.doesNotMatch(deployStep, /--yes\b/);
});

test("hosted staging deploy smoke test validates public providers and locks both Admin APIs", () => {
  assert.ok(workflow.includes("/api/auth/providers"));
  assert.match(workflow, /public provider response must not expose client IDs, secrets, or private settings/);
  assert.ok(workflow.includes("/api/admin/login-providers"));
  assert.match(workflow, /Admin provider settings must reject requests without a Better Auth resource token/);
  assert.ok(workflow.includes('unauthenticatedAdminBody.error, "AUTH_REQUIRED"'));
  assert.match(workflow, /Admin provider settings must reject untrusted browser origins/);
  assert.ok(workflow.includes("/api/admin/email-settings"));
  assert.match(workflow, /Admin email settings must reject requests without a Better Auth resource token/);
  assert.ok(workflow.includes('unauthenticatedEmailAdminBody.error, "AUTH_REQUIRED"'));
  assert.match(workflow, /Admin email settings must reject untrusted browser origins/);
  assert.match(workflow, /untrusted origins must not receive Admin CORS permission/);
});


test("OAuth encryption secret is created once and never rotated or logged", () => {
  const step = workflow.split("      - name: Ensure dedicated OAuth-provider encryption key exists without rotating")[1]
    ?.split("      - name: Verify hosted health")[0];
  assert.ok(step, "OAuth-provider encryption bootstrap step should exist");
  assert.match(step, /workers\/scripts/);
  assert.match(step, /AUTH_PROVIDER_ENCRYPTION_KEY/);
  assert.match(step, /randomBytes\(32\)/);
  assert.match(step, /matches\.length === 1/);
  assert.match(step, /Preserved existing dedicated OAuth-provider encryption secret/);
  assert.match(step, /method: "PUT"/);
  assert.doesNotMatch(step, /console\.log\([^\n]*generatedKey|console\.log\([^\n]*text:/i);
  assert.doesNotMatch(step, /DELETE|wrangler secret delete/i);
});

test("failed-deploy diagnostic upload has a valid failure-only condition", () => {
  assert.match(workflow, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(workflow, /name: auth-worker-staging-deploy-diagnostic/);
  assert.match(workflow, /retention-days: 3/);
  assert.match(workflow, /wrangler-deploy-sanitized\.log/);
});

test("runner and first-party actions use a stable Node 24-compatible toolchain", () => {
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
  assert.doesNotMatch(workflow, /actions\/(checkout|setup-node)@v4/);
});

test("routine redeploy preserves provisioned Worker secrets and cleans temporary logs", () => {
  assert.equal(workflow.includes("auth-worker-staging-secrets.json"), false);
  assert.equal(workflow.includes("Prepare only missing Worker secrets"), false);
  assert.match(workflow, /Wrangler preserves existing Worker secrets/);
  assert.equal(workflow.includes("wrangler-deploy.log"), true);
  assert.equal(workflow.includes("wrangler-deploy-sanitized.log"), true);
  assert.match(workflow, /name: Remove temporary secret material from runner/);
});

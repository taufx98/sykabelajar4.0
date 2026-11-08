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
  assert.match(workflow, /paths:\n      - "\.github\/auth-ops\/DEPLOY-STAGING-WORKER-0007"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*push/);
  assert.match(workflow, /DEPLOY-STAGING-WORKER-0007/);
  assert.match(workflow, /DEPLOY-STAGING-WORKER-sykabelajar-auth-poc/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
});

test("staging deployment is hard-bound to the reviewed Worker, D1, and hostname", () => {
  assert.match(workflow, /name = "sykabelajar-auth-poc"/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(workflow, /auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /DEV_APP_ORIGIN/);
  assert.match(wranglerConfig, /^DEV_APP_ORIGIN = "https:\/\/security-auth-poc-stage-1\.sykabelajar4\.pages\.dev"$/m);
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
  assert.doesNotMatch(wranglerConfig, /^SUPABASE_PROVISIONING_ENABLED = "true"$/m);
  assert.match(wranglerConfig, /^AUTH_EMAIL_PROVIDER = "managed"$/m);
  assert.match(workflow, /auth_email_accounts/);
  assert.match(workflow, /auth-worker-staging-email-provider.json/);
  assert.match(workflow, /Transactional email provider migration 0006 is missing/);
  assert.match(workflow, /expected\.length !== 20/);
  assert.match(workflow, /auth_phone_verification_challenges/);
  assert.match(workflow, /auth_social_provider_settings/);
  assert.match(workflow, /auth_social_provider_meta/);
  assert.match(workflow, /social_provider_meta/);
  assert.match(workflow, /phone_challenges/);
  assert.doesNotMatch(workflow, /SERVICE_ROLE|service_role/i);
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

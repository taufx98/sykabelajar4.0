import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/auth-worker-staging-deploy.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");
const wranglerConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("staging Worker deploy is manual-only and branch-guarded", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /DEPLOY-STAGING-WORKER-sykabelajar-auth-poc/);
  assert.match(workflow, /CONFIRMATION.*inputs\.confirmation/);
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
  assert.match(workflow, /SUPABASE_URL.*mvdczyitbkxkldjughor/);
  assert.doesNotMatch(workflow, /SERVICE_ROLE|service_role/i);
  assert.doesNotMatch(workflow, /wrangler\s+d1\s+(delete|create)/i);
});

test("Wrangler deploy command uses only supported arguments", () => {
  const deployStep = workflow.split("      - name: Deploy only the isolated Better Auth staging Worker")[1]
    ?.split("      - name: Verify hosted health")[0];
  assert.ok(deployStep, "deploy step should exist");
  assert.match(deployStep, /npx wrangler deploy/);
  assert.match(deployStep, /--secrets-file/);
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

test("temporary generated secret files and deploy logs are removed", () => {
  assert.match(workflow, /auth-worker-staging-secrets\.json/);
  assert.match(workflow, /wrangler-deploy\.log/);
  assert.match(workflow, /wrangler-deploy-sanitized\.log/);
  assert.match(workflow, /name: Remove temporary secret material from runner/);
});

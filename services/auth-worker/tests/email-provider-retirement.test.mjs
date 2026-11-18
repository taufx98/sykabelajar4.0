import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../migrations/0014_finalize_email_provider_allowlist.sql");
const admin = read("../src/email-admin.ts");
const worker = read("../src/email-providers.mjs");
const email = read("../src/email.ts");
const panel = read("../../../src/components/admin/TransactionalEmailSettingsPanel.tsx");
const workflow = read("../../../.github/workflows/auth-finalize-email-provider-staging.yml");
const stagingDeploy = read("../../../.github/workflows/auth-worker-staging-deploy.yml");
const productionDeploy = read("../../../.github/workflows/auth-cloudflare-production-worker-deploy.yml");

test("final provider schema keeps SendPulse and all approved adapters only", () => {
  assert.ok(migration.includes("provider IN ('sendpulse','brevo','mailjet','mailtrap','resend','custom_http')"));
  assert.ok(!/zeptomail/i.test(migration));
  assert.ok(migration.includes("provider = 'custom_http' AND endpoint_url IS NOT NULL"));
  assert.ok(migration.includes("auth_mode IN ('none','bearer','api_key','basic')"));
});

test("migration preserves every provider credential, routing, quota and delivery field", () => {
  const columns = [
    "id,label,provider,sender_address,sender_name,endpoint_url,auth_mode,credentials_ciphertext",
    "enabled,priority,quota_hour_limit,quota_day_limit,quota_month_limit",
    "hour_bucket,hour_used,day_bucket,day_used,month_bucket,month_used",
    "cooldown_until,last_error_code,last_error_at,last_success_at",
    "created_at,updated_at,created_by,updated_by",
  ];
  for (const value of columns) assert.ok(migration.includes(value), "Missing preserved column: " + value);
  assert.ok(migration.includes("INSERT INTO auth_email_provider_accounts ("));
  assert.ok(migration.includes("FROM auth_email_provider_accounts_before_allowlist"));
  assert.ok(migration.includes("DROP TABLE auth_email_provider_accounts_before_allowlist"));
  assert.doesNotMatch(migration, /INSERT INTO ["']?(user|account|session)["']?|UPDATE ["']?(user|account|session)["']?|DELETE FROM ["']?(user|account|session)["']?/i);
});

test("active Worker, Admin API and Admin panel contain no unsupported provider implementation", () => {
  assert.match(admin, /"sendpulse"/);
  assert.match(worker, /sendpulse:/);
  assert.match(email, /"sendpulse"/);
  assert.match(panel, /sendpulse/);
  for (const source of [admin, worker, email, panel]) assert.doesNotMatch(source, /zeptomail/i);
});

test("staging schema workflow is owner-gated, staging-only and fingerprints sensitive rows without logging them", () => {
  assert.ok(workflow.includes("github.actor == 'taufx98'"));
  assert.ok(workflow.includes("security/auth-poc-stage-1"));
  assert.ok(workflow.includes("FINALIZE-MANAGED-EMAIL-sykabelajar-auth-poc"));
  assert.ok(workflow.includes("7a4f9008-a1c6-42b6-8a04-abde12699248"));
  assert.ok(workflow.includes("0013_zeptomail_email_provider.sql"));
  assert.ok(workflow.includes("unsupported_rows"));
  assert.ok(workflow.includes("credentials_ciphertext"));
  assert.doesNotMatch(workflow, /wrangler[^\n]*deploy|wrangler[^\n]*secret|wrangler\.production/);
});

test("staging Worker deployment requires finalized schema and uses a fresh manual gate", () => {
  assert.ok(stagingDeploy.includes("DEPLOY-STAGING-WORKER-0015"));
  assert.ok(stagingDeploy.includes("0014_finalize_email_provider_allowlist.sql"));
  assert.ok(stagingDeploy.includes("schema.includes"));
});

test("Production Worker deploy remains constrained to the current 0000–0010 baseline", () => {
  assert.ok(productionDeploy.includes("0010_custom_http_email_provider.sql"));
  assert.ok(!productionDeploy.includes("0011_zeptomail_email_provider.sql"));
  assert.ok(productionDeploy.includes("Production D1 must have exactly migrations 0000–0010"));
});

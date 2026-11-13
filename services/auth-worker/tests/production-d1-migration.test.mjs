import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const productionConfig = readFileSync(new URL("../wrangler.production.toml", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-cloudflare-production-d1-migrate.yml", import.meta.url),
  "utf8",
);
const migrationDir = new URL("../migrations-production/", import.meta.url);
const migrations = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();

test("Production runtime config reuses the existing Worker hostname with its own new D1 binding", () => {
  assert.match(productionConfig, /^name = "sykabelajar-auth-poc"$/m);
  assert.match(stagingConfig, /^name = "sykabelajar-auth-poc"$/m);
  assert.match(productionConfig, /^database_name = "sykabelajar-auth-prod"$/m);
  assert.match(productionConfig, /^database_id = "6d4dc7b5-8e71-4fdc-9cda-3230e49951c7"$/m);
  assert.match(productionConfig, /^pattern = "auth\.sykabelajar\.my\.id"$/m);
  assert.match(productionConfig, /^APP_ORIGIN = "https:\/\/sykabelajar\.my\.id"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENV = "production"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENABLED = "false"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_URL = "https:\/\/mvdczyitbkxkldjughor\.supabase\.co"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_PUBLISHABLE_KEY = "sb_publishable_M0wRkz7pdVB-0s5JtT3Zhg_J9fXU31m"$/m);
  assert.match(productionConfig, /^OAUTH_CALLBACK_URL = "https:\/\/sykabelajar\.my\.id\/auth\/oidc\/callback"$/m);
  assert.doesNotMatch(productionConfig, /DEV_APP_ORIGIN|auth-staging\.sykabelajar\.my\.id|staging\.sykabelajar\.my\.id/);
});

test("Production D1 migrations deliberately omit the staging-only callback migration", () => {
  assert.deepEqual(migrations, [
    "0000_auth_worker_internal_config.sql",
    "0001_better_auth.sql",
    "0002_seed_first_party_oauth_client.sql",
    "0003_zeptomail_agent_settings.sql",
    "0004_better_auth_registration_attributes.sql",
    "0005_telegram_phone_verification.sql",
    "0006_transactional_email_provider.sql",
    "0007_managed_social_login_providers.sql",
  ]);
  const seed = readFileSync(new URL("../migrations-production/0002_seed_first_party_oauth_client.sql", import.meta.url), "utf8");
  assert.ok(seed.includes('["https://sykabelajar.my.id/auth/oidc/callback"]'));
  assert.doesNotMatch(seed, /staging\.sykabelajar\.my\.id/);
});

test("Production D1 migration workflow is pinned to the exact new database and cannot deploy the Worker", () => {
  assert.match(workflow, /APPLY-TO-sykabelajar-auth-prod:6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(workflow, /sykabelajar-auth-prod/);
  assert.match(workflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(workflow, /migrations-production/);
  assert.match(workflow, /0000–0007/);
  assert.match(workflow, /workerDeploymentAttempted|did not deploy a Worker/);
  assert.doesNotMatch(workflow, /wrangler deploy/i);
});

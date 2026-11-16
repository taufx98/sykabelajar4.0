import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const productionConfig = readFileSync(new URL("../wrangler.production.toml", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const runtimeMigration = readFileSync(new URL("../migrations-production/0008_auth_runtime_settings.sql", import.meta.url), "utf8");
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

test("Production keeps public signup closed while staging remains open", () => {
  assert.match(productionConfig, /^AUTH_SIGNUP_DISABLED = "true"$/m);
  assert.match(stagingConfig, /^AUTH_SIGNUP_DISABLED = "false"$/m);
  assert.match(authSource, /env\.AUTH_SIGNUP_DISABLED === "true"/);
  assert.match(authSource, /env\.SUPABASE_PROVISIONING_ENV === "production" && env\.AUTH_SIGNUP_DISABLED !== "false"/);

  const emailAndPassword = authSource.slice(
    authSource.indexOf("emailAndPassword: {"),
    authSource.indexOf("emailVerification: {"),
  );
  assert.match(emailAndPassword, /disableSignUp: signupDisabled/);

  for (const provider of ["google", "github", "facebook", "twitter"]) {
    const start = authSource.indexOf(provider + ": {");
    assert.ok(start >= 0, "expected a " + provider + " provider configuration");
    const end = authSource.indexOf("\n          },", start);
    assert.ok(end > start, "could not locate the " + provider + " provider block");
    const block = authSource.slice(start, end);
    assert.match(block, /disableSignUp: signupDisabled/);
    if (provider === "google" || provider === "github") {
      // Social login must not create an account implicitly; Register opts in
      // with Better Auth's requestSignUp flag. Production signup stays closed.
      assert.match(block, /disableImplicitSignUp: true/);
    } else {
      assert.match(block, /disableImplicitSignUp: signupDisabled/);
    }
  }
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
    "0008_auth_runtime_settings.sql",
    "0009_multi_provider_email_routing.sql",
    "0010_custom_http_email_provider.sql",
  ]);
  const seed = readFileSync(new URL("../migrations-production/0002_seed_first_party_oauth_client.sql", import.meta.url), "utf8");
  assert.ok(seed.includes('["https://sykabelajar.my.id/auth/oidc/callback"]'));
  assert.doesNotMatch(seed, /staging\.sykabelajar\.my\.id/);
  assert.match(runtimeMigration, /email_verification_required INTEGER NOT NULL DEFAULT 1/);
  assert.match(runtimeMigration, /CHECK \(email_verification_required IN \(0, 1\)\)/);
  assert.match(runtimeMigration, /VALUES \(1, 1, 'system'\)/);
  assert.doesNotMatch(runtimeMigration, /INSERT INTO "(user|session|account)"|UPDATE "(user|session|account)"/i);
  const emailMigration = readFileSync(new URL("../migrations-production/0009_multi_provider_email_routing.sql", import.meta.url), "utf8");
  assert.match(emailMigration, /provider IN \('sendpulse','brevo','mailjet','mailtrap','resend'\)/);
  assert.match(emailMigration, /auto_failover_enabled INTEGER NOT NULL DEFAULT 1/);
  assert.match(emailMigration, /VALUES \(1, 1, CURRENT_TIMESTAMP, NULL\)/);
  assert.match(emailMigration, /credentials_ciphertext TEXT NOT NULL/);
  assert.doesNotMatch(emailMigration, /INSERT INTO auth_email_provider_accounts/i);
  const customMigration = readFileSync(new URL("../migrations-production/0010_custom_http_email_provider.sql", import.meta.url), "utf8");
  assert.match(customMigration, /custom_http/);
  assert.match(customMigration, /endpoint_url TEXT/);
  assert.match(customMigration, /auth_mode TEXT/);
  assert.match(customMigration, /INSERT INTO auth_email_provider_accounts/);
  assert.match(customMigration, /FROM auth_email_provider_accounts_before_custom_http/);
  assert.doesNotMatch(customMigration, /INSERT INTO \"(user|session|account)\"|UPDATE \"(user|session|account)\"/i);
});

test("Production D1 migration workflow is pinned, owner-gated by manual dispatch or a one-time marker, and cannot deploy the Worker", () => {
  assert.match(workflow, /APPLY-PRODUCTION-D1-sykabelajar-auth-prod-6d4dc7b5/);
  assert.match(workflow, /sykabelajar-auth-prod/);
  assert.match(workflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(workflow, /migrations-production/);
  assert.match(workflow, /0000–0010/);
  assert.match(workflow, /0009_multi_provider_email_routing\.sql/);
  assert.match(workflow, /0010_multi_provider_email_routing\.sql/);
  assert.match(workflow, /auth_email_provider_accounts/);
  assert.match(workflow, /auth_email_provider_settings/);
  assert.match(workflow, /APPLY-PRODUCTION-D1-sykabelajar-auth-prod-6d4dc7b5/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /APPLY-PRODUCTION-D1-0002/);
  assert.match(workflow, /exact Production D1 0002 marker/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
  assert.match(workflow, /email_verification_required=1/);
  assert.match(workflow, /workerDeploymentAttempted|did not deploy a Worker/);
  assert.doesNotMatch(workflow, /wrangler deploy/i);
});

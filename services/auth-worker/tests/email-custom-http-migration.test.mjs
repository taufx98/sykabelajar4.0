import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/auth-custom-http-email-staging.yml", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0012_custom_http_email_provider.sql", import.meta.url), "utf8");
const productionMigration = readFileSync(new URL("../migrations-production/0010_custom_http_email_provider.sql", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("custom HTTP email schema migration is owner-confirmed and pinned to staging only", () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.ok(workflow.includes('".github/auth-ops/APPLY-CUSTOM-HTTP-EMAIL-0001"'));
  assert.match(workflow, /CONFIRMATION_INPUT/);
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /APPLY-CUSTOM-HTTP-EMAIL-sykabelajar-auth-poc/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(stagingConfig, /^database_id = "7a4f9008-a1c6-42b6-8a04-abde12699248"$/m);
  assert.doesNotMatch(workflow, /wrangler\s+--config\s+wrangler\.production\.toml|d1\s+(?:migrations\s+apply|execute)\s+sykabelajar-auth-prod|mvdczyitbkxkldjughor\.supabase\.co/);
  assert.doesNotMatch(workflow, /wrangler\s+deploy|wrangler\s+secret\s+(put|delete)/i);
});

test("schema rebuild preserves existing email provider settings but does not touch Better Auth identities", () => {
  assert.match(migration, /ALTER TABLE auth_email_provider_accounts/);
  assert.match(migration, /INSERT INTO auth_email_provider_accounts/);
  assert.match(migration, /FROM auth_email_provider_accounts_before_custom_http/);
  assert.match(migration, /provider IN \('sendpulse','brevo','mailjet','mailtrap','resend','custom_http'\)/);
  assert.match(migration, /endpoint_url TEXT/);
  assert.match(migration, /auth_mode TEXT/);
  assert.match(migration, /credentials_ciphertext TEXT NOT NULL/);
  assert.doesNotMatch(migration, /INSERT INTO "(user|account|session)"|UPDATE "(user|account|session)"/i);
  assert.equal(migration, productionMigration);
});

test("workflow compares Better Auth user, account, session and email-provider counts before and after migration", () => {
  assert.match(workflow, /custom-email-before-counts\.json/);
  assert.match(workflow, /custom-email-after-counts\.json/);
  assert.match(workflow, /custom-email-before-providers\.json/);
  assert.match(workflow, /custom-email-after-providers\.json/);
  assert.match(workflow, /credentials_ciphertext/);
  assert.match(workflow, /providerFingerprintBefore/);
  assert.match(workflow, /fingerprintAfter/);
  for (const key of ["users", "accounts", "sessions", "email_accounts"]) {
    assert.ok(workflow.includes('"' + key + '"'), "missing preservation check for " + key);
  }
  assert.match(workflow, /APPLY-CUSTOM-HTTP-EMAIL-sykabelajar-auth-poc/);
  assert.match(workflow, /npm run typecheck && npm test/);
  assert.match(workflow, /git hash-object migrations\/0012_custom_http_email_provider\.sql/);
});

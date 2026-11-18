import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const providers = read("../src/email-providers.mjs");
const email = read("../src/email.ts");
const admin = read("../src/email-admin.ts");
const panel = read("../../../src/components/admin/TransactionalEmailSettingsPanel.tsx");
const stagingMigration = read("../migrations/0013_zeptomail_email_provider.sql");
const productionMigration = read("../migrations-production/0011_zeptomail_email_provider.sql");

test("ZeptoMail is a first-class provider in Worker readiness, Admin routing and the panel", () => {
  assert.match(providers, /zeptomail: "https:\/\/cpaas\.zoho\.com\/v1\.1\/email"/);
  assert.match(email, /"zeptomail"/);
  assert.match(admin, /"zeptomail"/);
  assert.match(admin, /normalizeSendMailToken\(nonEmpty\(input\.apiKey\)\)/);
  assert.match(admin, /Zoho-enczapikey/);
  assert.match(panel, /zeptomail: 'ZeptoMail'/);
  assert.match(panel, /ZeptoMail Send Mail Token \(Agent-specific\)/);
  assert.match(panel, /SMTP\/API → API Setup/);
});

test("ZeptoMail Send Mail token normalization accepts an optional authorization prefix", () => {
  assert.match(admin, /function normalizeSendMailToken\(value: string\)/);
  assert.match(admin, /value\.replace\(\/\^Zoho-enczapikey\\s\+\/i, ""\)\.trim\(\)/);
  const normalize = admin.slice(admin.indexOf("function normalizeCredentials"), admin.indexOf("function quotaValue"));
  assert.match(normalize, /provider === "zeptomail"/);
  assert.match(normalize, /token\.length < 16 \|\| token\.length > 4096/);
  assert.match(normalize, /return \{ apiKey: token \}/);
});

test("staging and Production migrations rebuild only the routing table and preserve all account and quota columns", () => {
  assert.equal(stagingMigration, productionMigration);
  for (const migration of [stagingMigration, productionMigration]) {
    assert.match(migration, /DROP INDEX IF EXISTS auth_email_provider_accounts_route_idx/);
    assert.match(migration, /ALTER TABLE auth_email_provider_accounts\s+RENAME TO auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /provider IN \('sendpulse','brevo','mailjet','mailtrap','resend','custom_http','zeptomail'\)/);
    assert.match(migration, /endpoint_url TEXT/);
    assert.match(migration, /auth_mode TEXT/);
    assert.match(migration, /credentials_ciphertext TEXT NOT NULL/);
    assert.match(migration, /INSERT INTO auth_email_provider_accounts\s*\([\s\S]*?credentials_ciphertext[\s\S]*?hour_bucket[\s\S]*?updated_by\)/);
    assert.match(migration, /SELECT\s+id,label,provider,sender_address,sender_name,endpoint_url,auth_mode,credentials_ciphertext,[\s\S]*?hour_bucket,hour_used,day_bucket,day_used,month_bucket,month_used,[\s\S]*?created_by,updated_by\s+FROM auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /DROP TABLE auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS auth_email_provider_accounts_route_idx/);
    assert.doesNotMatch(migration, /INSERT INTO "(user|account|session)"|UPDATE "(user|account|session)"|DELETE FROM "(user|account|session)"/i);
    assert.doesNotMatch(migration, /Zoho-enczapikey|send_mail_token|apiKey|token/i);
  }
});

test("staging and Production ZeptoMail D1 migrations are separately owner-gated and never deploy Workers", () => {
  const stagingWorkflow = read("../../../.github/workflows/auth-zeptomail-email-staging.yml");
  const productionWorkflow = read("../../../.github/workflows/auth-cloudflare-production-zeptomail-migrate.yml");
  assert.match(stagingWorkflow, /APPLY-ZEPTOMAIL-EMAIL-0013/);
  assert.match(stagingWorkflow, /APPLY-ZEPTOMAIL-EMAIL-sykabelajar-auth-poc/);
  assert.match(stagingWorkflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(stagingWorkflow, /git hash-object migrations\/0013_zeptomail_email_provider\.sql/);
  assert.match(stagingWorkflow, /providerFingerprintBefore/);
  assert.match(stagingWorkflow, /identityFingerprintBefore/);
  assert.match(stagingWorkflow, /0012_custom_http_email_provider\.sql/);
  assert.match(stagingWorkflow, /Required staging migration missing/);
  assert.match(stagingWorkflow, /Unexpected staging D1 migration history/);
  assert.match(stagingWorkflow, /zeptomailProviderAllowed/);
  assert.match(stagingWorkflow, /npm run typecheck && npm test/);
  assert.doesNotMatch(stagingWorkflow, /wrangler\s+deploy|wrangler\s+secret\s+(put|delete)/i);
  assert.doesNotMatch(stagingWorkflow, /wrangler --config wrangler\.production\.toml|sykabelajar-auth-prod|mvdczyitbkxkldjughor/);

  assert.match(productionWorkflow, /APPLY-PRODUCTION-ZEPTOMAIL-0011/);
  assert.match(productionWorkflow, /APPLY-PRODUCTION-ZEPTOMAIL-sykabelajar-auth-prod/);
  assert.match(productionWorkflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(productionWorkflow, /git hash-object migrations-production\/0011_zeptomail_email_provider\.sql/);
  assert.match(productionWorkflow, /providerAndQuotaFingerprintRecorded/);
  assert.match(productionWorkflow, /identityFingerprintRecorded/);
  assert.match(productionWorkflow, /WorkerDeploymentAttempted:false/);
  assert.match(productionWorkflow, /secretsOrDnsChanged:false/);
  assert.match(productionWorkflow, /npm run check/);
  assert.doesNotMatch(productionWorkflow, /wrangler\s+deploy|wrangler\s+secret\s+(put|delete)/i);
});

test("Production Worker deploy-only workflow preserves existing secrets, staging binding and closed signup", () => {
  const workflow = read("../../../.github/workflows/auth-cloudflare-production-worker-deploy.yml");
  assert.match(workflow, /DEPLOY-PRODUCTION-AUTH-WORKER-0011/);
  assert.match(workflow, /DEPLOY-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod/);
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /sykabelajar-auth-prod/);
  assert.match(workflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(workflow, /auth-prod\.sykabelajar\.my\.id/);
  assert.match(workflow, /auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /production-secret-names-before/);
  assert.match(workflow, /secretNames\.join/);
  assert.match(workflow, /assert\.equal\(secretNames\.join/);
  assert.match(workflow, /secretValuesRead:false/);
  assert.match(workflow, /Production signup must stay closed/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /wrangler --config wrangler\.production\.toml deploy --message/);
  assert.doesNotMatch(workflow, /workers\/scripts\/sykabelajar-auth-prod\/secrets[^\n]*method:\s*"PUT"/i);
  assert.doesNotMatch(workflow, /wrangler\s+secret\s+(put|delete)|randomBytes\(32\)/i);
});

test("Production Cloudflare preflight tolerates ZeptoMail schema pending or applied without performing writes", () => {
  const workflow = read("../../../.github/workflows/auth-cloudflare-production-preflight.yml");
  assert.match(workflow, /0011_zeptomail_email_provider\.sql/);
  assert.match(workflow, /expectedWithoutZeptoMail/);
  assert.match(workflow, /zeptomailMigrationApplied/);
  assert.match(workflow, /production-d1-email-schema\.json/);
  assert.match(workflow, /zeptomailProviderSchema/);
  assert.match(workflow, /remoteOperations: "SELECT only"/);
  assert.match(workflow, /migrationApplyAttempted: false/);
  assert.doesNotMatch(workflow, /wrangler d1 migrations apply|wrangler\s+deploy/i);
});

test("ZeptoMail remains a generic encrypted API-key provider without a legacy-table fallback", () => {
  assert.match(email, /credentials_ciphertext/);
  assert.match(email, /decryptEmailSecret/);
  assert.match(email, /hasRequiredProviderCredentials/);
  assert.match(email, /FROM auth_email_provider_accounts WHERE enabled = 1/);
  assert.doesNotMatch(email, /auth_email_accounts|auth_email_settings|sendZeptoMail|readLegacyEmailAccount/);
  assert.match(admin, /credentialConfigured/);
  assert.doesNotMatch(admin.slice(admin.indexOf("const safeAccounts"), admin.indexOf("return json")), /credentials_ciphertext|send_mail_token_ciphertext/);
});

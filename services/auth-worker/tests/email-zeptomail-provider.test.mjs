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

test("ZeptoMail remains a generic encrypted API-key provider without a legacy-table fallback", () => {
  assert.match(email, /credentials_ciphertext/);
  assert.match(email, /decryptEmailSecret/);
  assert.match(email, /hasRequiredProviderCredentials/);
  assert.match(email, /FROM auth_email_provider_accounts WHERE enabled = 1/);
  assert.doesNotMatch(email, /auth_email_accounts|auth_email_settings|sendZeptoMail|readLegacyEmailAccount/);
  assert.match(admin, /credentialConfigured/);
  assert.doesNotMatch(admin.slice(admin.indexOf("const safeAccounts"), admin.indexOf("return json")), /credentials_ciphertext|send_mail_token_ciphertext/);
});

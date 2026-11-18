import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const staging = readFileSync(new URL("../migrations/0013_zeptomail_email_provider.sql", import.meta.url), "utf8");
const production = readFileSync(new URL("../migrations-production/0011_zeptomail_email_provider.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/email-providers.mjs", import.meta.url), "utf8");
const email = readFileSync(new URL("../src/email.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/email-admin.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../../src/components/admin/TransactionalEmailSettingsPanel.tsx", import.meta.url), "utf8");

test("ZeptoMail schema migrations are the same isolated routing-table expansion for staging and Production", () => {
  assert.equal(staging, production);
  for (const migration of [staging, production]) {
    assert.match(migration, /provider IN \('sendpulse','brevo','mailjet','mailtrap','resend','custom_http','zeptomail'\)/);
    assert.match(migration, /ALTER TABLE auth_email_provider_accounts\s+RENAME TO auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /INSERT INTO auth_email_provider_accounts/);
    assert.match(migration, /FROM auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /credentials_ciphertext/);
    assert.match(migration, /hour_bucket,hour_used,day_bucket,day_used,month_bucket,month_used/);
    assert.match(migration, /cooldown_until,last_error_code,last_error_at,last_success_at,created_at,updated_at,created_by,updated_by/);
    assert.match(migration, /endpoint_url TEXT/);
    assert.match(migration, /auth_mode TEXT/);
    assert.match(migration, /DROP TABLE auth_email_provider_accounts_before_zeptomail/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS auth_email_provider_accounts_route_idx/);
    assert.doesNotMatch(migration, /INSERT INTO "(user|account|session)"|UPDATE "(user|account|session)"|DELETE FROM "(user|account|session)"/i);
    assert.doesNotMatch(migration, /Zoho-enczapikey|send_mail_token|apiKey|credential value/i);
  }
});

test("ZeptoMail has one official endpoint and its Agent token is sent only as the Authorization header", () => {
  assert.match(worker, /zeptomail: "https:\/\/cpaas\.zoho\.com\/v1\.1\/email"/);
  assert.match(worker, /Zoho-enczapikey/);
  assert.match(worker, /textbody: values\.text/);
  assert.match(worker, /allowedRedirectOrigin: "https:\/\/cpaas\.zoho\.com"/);
  assert.match(worker, /result\?\.message !== "OK"/);
  assert.match(worker, /result\.request_id/);
  assert.match(email, /"zeptomail"/);
  assert.match(admin, /"zeptomail"/);
  assert.match(admin, /normalizeSendMailToken\(nonEmpty\(input\.apiKey\)\)/);
  assert.match(panel, /zeptomail: 'ZeptoMail'/);
  assert.match(panel, /Send Mail Token \(Agent-specific\)/);
});

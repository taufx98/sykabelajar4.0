import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const emailSource = readFileSync(new URL("../src/email.ts", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../src/email-admin.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0010_multi_provider_email_routing.sql", import.meta.url), "utf8");

test("managed auth email uses all enabled providers in configured priority order", () => {
  assert.match(emailSource, /FROM auth_email_provider_accounts WHERE enabled = 1 ORDER BY priority ASC, created_at ASC/);
  assert.match(emailSource, /auto_failover_enabled/);
  assert.match(emailSource, /accounts\.slice\(0, 1\)/);
  for (const provider of ["sendpulse", "brevo", "mailjet", "mailtrap", "resend", "zeptomail", "custom_http"]) {
    assert.ok(emailSource.includes(provider) || adminSource.includes('"' + provider + '"'));
  }
});

test("D1 quota reservation is atomic and checks hourly, daily, monthly limits and cooldown", () => {
  assert.match(emailSource, /UPDATE auth_email_provider_accounts SET/);
  assert.match(emailSource, /quota_hour_limit/);
  assert.match(emailSource, /quota_day_limit/);
  assert.match(emailSource, /quota_month_limit/);
  assert.match(emailSource, /cooldown_until/);
  assert.match(emailSource, /RETURNING id/);
  assert.match(migration, /hour_bucket/);
  assert.match(migration, /day_bucket/);
  assert.match(migration, /month_bucket/);
});

test("only definitive quota or credential rejection may trigger cross-provider failover", () => {
  assert.match(emailSource, /error\.allowFailover\) continue/);
  assert.match(emailSource, /AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN/);
  assert.match(emailSource, /ambiguous/);
  assert.match(adminSource, /EMAIL_PROVIDER_QUOTA_REACHED/);
  assert.match(adminSource, /EMAIL_PROVIDER_CREDENTIAL_REJECTED/);
});

test("new auth email delivery never falls back to legacy ZeptoMail/Brevo accounts", () => {
  assert.doesNotMatch(emailSource, /auth_email_settings|auth_email_accounts|sendZeptoMail|readLegacyEmailAccount|sendLegacyEmail/);
  assert.match(emailSource, /if \(accounts\.length === 0\) throw new Error/);
  assert.match(emailSource, /AUTH_EMAIL_ALL_PROVIDERS_EXHAUSTED/);
  assert.match(emailSource, /AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN/);
});

test("verification readiness requires an enabled provider with a decryptable credential", () => {
  const readiness = emailSource.slice(
    emailSource.indexOf("export async function isAuthEmailVerificationConfigured"),
    emailSource.indexOf("async function sendManagedEmail"),
  );
  assert.match(readiness, /FROM auth_email_provider_accounts WHERE enabled = 1/);
  assert.match(readiness, /decryptEmailSecret/);
  assert.match(readiness, /quota_hour_limit/);
  assert.match(readiness, /quota_day_limit/);
  assert.match(readiness, /quota_month_limit/);
  assert.match(readiness, /cooldown_until/);
  assert.match(emailSource, /hasRequiredProviderCredentials/);
  assert.match(emailSource, /provider === "mailjet"[\s\S]*?credentials\.apiSecret/);
  assert.match(emailSource, /provider === "mailtrap"[\s\S]*?credentials\.apiToken/);
  assert.match(emailSource, /"zeptomail"/);
  assert.match(readiness, /return false/);
});

test("Admin API protects all routing controls and never returns credential ciphertext", () => {
  const handler = adminSource.slice(adminSource.indexOf("export async function handleEmailAdminRequest"));
  assert.match(handler, /requireActiveAdmin/);
  assert.match(handler, /action === "save"/);
  assert.match(handler, /action === "configure"/);
  assert.match(handler, /action === "test"/);
  assert.match(handler, /action === "delete"/);
  const listing = adminSource.slice(adminSource.indexOf("async function listSettings"), adminSource.indexOf("async function saveAccount"));
  assert.match(listing, /credential_configured/);
  const projection = listing.slice(listing.indexOf("const safeAccounts"), listing.indexOf("return json"));
  assert.match(projection, /credentialConfigured/);
  assert.doesNotMatch(projection, /credentials_ciphertext|send_mail_token_ciphertext/);
});

test("provider test mail is sent only to the authenticated Admin email and is rate limited", () => {
  const testAccount = adminSource.slice(adminSource.indexOf("async function testAccount"), adminSource.indexOf("export async function handleEmailAdminRequest"));
  assert.match(testAccount, /to:\s*user\.email/);
  assert.match(testAccount, /auth_email_admin_test_limits/);
  assert.match(testAccount, /last_sent_at <= \?3/);
});

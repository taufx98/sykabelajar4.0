import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/auth-email-routing-d1-staging.yml", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0010_multi_provider_email_routing.sql", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("email routing migration is owner-only and pinned to isolated staging D1", () => {
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /GITHUB_ACTOR.*taufx98/);
  assert.match(workflow, /APPLY-STAGING-D1-0010/);
  assert.match(workflow, /APPLY-MULTI-PROVIDER-EMAIL-sykabelajar-auth-poc/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(stagingConfig, /^database_id = "7a4f9008-a1c6-42b6-8a04-abde12699248"$/m);
  assert.doesNotMatch(workflow, /wrangler\.production\.toml|sykabelajar-auth-prod|mvdczyitbkxkldjughor/);
  assert.doesNotMatch(workflow, /wrangler\s+deploy|wrangler\s+secret\s+(put|delete)/i);
});

test("the migration supports exactly the five owner-selected free providers with failover on by default", () => {
  for (const provider of ["sendpulse", "brevo", "mailjet", "mailtrap", "resend"]) {
    assert.ok(migration.includes("'" + provider + "'"), "missing provider " + provider);
  }
  assert.match(migration, /auto_failover_enabled INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /VALUES \(1, 1, CURRENT_TIMESTAMP, NULL\)/);
  assert.match(migration, /credentials_ciphertext TEXT NOT NULL/);
  assert.match(migration, /quota_hour_limit/);
  assert.match(migration, /quota_day_limit/);
  assert.match(migration, /quota_month_limit/);
  assert.doesNotMatch(migration, /INSERT INTO auth_email_provider_accounts/i);
  assert.doesNotMatch(migration, /INSERT INTO "(user|session|account)"/i);
});

test("staging migration reconciles runtime settings and email routing through the guarded D1 migration ledger", () => {
  assert.match(workflow, /migrations\/0009_auth_runtime_settings\.sql/);
  assert.match(workflow, /migrations\/0010_multi_provider_email_routing\.sql/);
  assert.match(workflow, /f0bf29fcaebf416ddcdb3758000dc1fbecce7b7ee6be5bbd2e6e10e17755a158/);
  assert.match(workflow, /dcc1d9a18aff172a04305f932a8c4066393343fe8feb274421203cafb342bbe2/);
  assert.match(workflow, /SELECT name FROM d1_migrations/);
  assert.match(workflow, /Required staging migration is not recorded as applied/);
  assert.match(workflow, /d1 migrations apply sykabelajar-auth-poc --remote/);
  assert.match(workflow, /0009_auth_runtime_settings\.sql/);
  assert.match(workflow, /0010_multi_provider_email_routing\.sql/);
  assert.match(workflow, /Number\(policy\.auto_failover_enabled\)!==1/);
  assert.match(workflow, /Number\(inventory\.accounts\)!==0/);
  assert.match(workflow, /settings_rows/);
  assert.match(workflow, /npm run typecheck && npm test/);
});

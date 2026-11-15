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

test("staging migration applies only the additive email routing SQL and verifies empty credentials", () => {
  assert.match(workflow, /migrations\/0010_multi_provider_email_routing\.sql/);
  assert.match(workflow, /d1 execute sykabelajar-auth-poc --remote --file/);
  assert.match(workflow, /auto_failover_enabled/);
  assert.match(workflow, /Number\(policy\.auto_failover_enabled\)!==1/);
  assert.match(workflow, /Number\(inventory\.accounts\)!==0/);
  assert.match(workflow, /npm run typecheck && npm test/);
});

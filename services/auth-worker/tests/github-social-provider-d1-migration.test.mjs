import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0011_add_github_social_provider.sql", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../.github/workflows/auth-social-provider-d1-staging.yml", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../../../.github/workflows/auth-worker-staging-deploy.yml", import.meta.url), "utf8");
const emailWorkflow = readFileSync(new URL("../../../.github/workflows/auth-email-routing-d1-staging.yml", import.meta.url), "utf8");
const broadMigrationWorkflow = readFileSync(new URL("../../../.github/workflows/auth-cloudflare-d1-migrate.yml", import.meta.url), "utf8");

test("GitHub provider migration preserves every existing provider credential row", () => {
  assert.match(migration, /CREATE TABLE auth_social_provider_settings_next/);
  assert.match(migration, /provider IN \('google', 'github', 'facebook', 'twitter'\)/);
  assert.match(migration, /INSERT INTO auth_social_provider_settings_next[\s\S]*?SELECT[\s\S]*?FROM auth_social_provider_settings/);
  assert.match(migration, /client_secret_ciphertext/);
  assert.match(migration, /DROP TABLE auth_social_provider_settings/);
  assert.match(migration, /ALTER TABLE auth_social_provider_settings_next RENAME TO auth_social_provider_settings/);
  assert.doesNotMatch(migration, /DELETE FROM auth_social_provider_settings/i);
});

test("GitHub provider migration is owner-only and pinned to the exact staging D1", () => {
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /GITHUB_ACTOR.*taufx98/);
  assert.match(workflow, /APPLY-STAGING-D1-0011/);
  assert.match(workflow, /APPLY-GITHUB-SOCIAL-PROVIDER-sykabelajar-auth-poc/);
  assert.match(workflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(workflow, /sykabelajar-auth-poc/);
  assert.match(workflow, /wrangler.*d1 migrations apply sykabelajar-auth-poc --remote/);
  assert.match(workflow, /provider_rows/);
  assert.match(workflow, /before !== after/);
  assert.match(workflow, /fc51689b68c4750d1f2e0592c27e4a15e6c3acaab0e89e40e51e63e6890d2d71/);
  assert.doesNotMatch(workflow, /sykabelajar-auth-prod|mvdczyitbkxkldjughor|wrangler\.production\.toml/i);
  assert.doesNotMatch(workflow, /wrangler\s+deploy|wrangler\s+secret\s+(put|delete)/i);
});

test("email and broad staging migration workflows cannot apply GitHub migration implicitly", () => {
  assert.match(emailWorkflow, /0011_add_github_social_provider\.sql/);
  assert.match(emailWorkflow, /for \(const name of base\)/);
  assert.match(emailWorkflow, /only reviewed 0009\/0010 may be pending/);
  assert.match(broadMigrationWorkflow, /0011_add_github_social_provider\.sql/);
  assert.match(broadMigrationWorkflow, /Confirm GitHub social-provider migration 0011 was separately authorized and recorded/);
  assert.match(broadMigrationWorkflow, /if \(!names\.has\("0011_add_github_social_provider\.sql"\)\)/);
  assert.match(deployWorkflow, /GitHub social-provider D1 migration 0011 has not been separately authorized and applied/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/auth-cloudflare-d1-migrate.yml", import.meta.url),
);
const configPath = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");
const config = readFileSync(configPath, "utf8");

test("remote D1 schema migration has one exact guarded push marker and manual fallback", () => {
  assert.match(workflow, /^on:\n  push:/m);
  assert.match(workflow, /branches:\n      - security\/auth-poc-stage-1/);
  assert.match(workflow, /paths:\n      - "\.github\/auth-ops\/APPLY-STAGING-D1-0006"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*push/);
  assert.match(workflow, /APPLY-STAGING-D1-0006/);
  assert.match(workflow, /APPLY-TO-sykabelajar-auth-poc/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /migrationSha256/);
  assert.match(workflow, /c569ffe20088ba124c2eb1da19790b717715894dac7a373dd8a071b0aab2b778/);
  assert.match(workflow, /2d773a74cebf9f00ed95e42aa704855e3639827820875792874de5093519391f/);
  assert.match(workflow, /e29ecb4655bac013ded7db40051045d9c2507d3f7790b365cdbb8e2dfe1fd1b1/);
});

test("workflow is hard-bound to the known isolated D1 name and UUID", () => {
  const expectedUuid = "7a4f9008-a1c6-42b6-8a04-abde12699248";
  assert.match(config, /^name = "sykabelajar-auth-poc"$/m);
  assert.match(config, /^database_name = "sykabelajar-auth-poc"$/m);
  assert.match(config, new RegExp('^database_id = "' + expectedUuid + '"$', "m"));
  assert.match(workflow, new RegExp(expectedUuid));
  assert.match(workflow, /\/d1\/database\?name=/);
  assert.match(workflow, /matches\[0\]\.uuid !== expectedUuid/);
});

test("workflow applies only the reviewed D1 migration directory remotely", () => {
  for (const file of [
    "0000_auth_worker_internal_config.sql",
    "0001_better_auth.sql",
    "0002_seed_first_party_oauth_client.sql",
    "0003_zeptomail_agent_settings.sql",
    "0004_better_auth_registration_attributes.sql",
    "0005_telegram_phone_verification.sql",
    "0006_transactional_email_provider.sql",
  ]) {
    assert.ok(workflow.includes(file), "missing migration guard for " + file);
  }
  assert.match(workflow, /d1 migrations list sykabelajar-auth-poc --remote/);
  assert.match(workflow, /d1 migrations apply sykabelajar-auth-poc --remote/);
  assert.match(workflow, /d1 execute sykabelajar-auth-poc --remote --json/);
  assert.match(workflow, /auth_email_accounts/);
  assert.match(workflow, /oauthClient/);
  assert.match(workflow, /better_auth_registration_attributes/);
  assert.match(workflow, /auth_phone_verification_challenges/);
  assert.match(workflow, /auth-d1-email-provider-column.json/);
  assert.match(workflow, /provider-aware transactional email schema/);
  assert.match(workflow, /pragma_table_info\('user'\)/);
  const requiredProfileColumns = [
    "accountType", "username", "referralCode",
    "birthDate", "institution", "grade", "subjects",
  ];
  for (const column of requiredProfileColumns) {
    assert.match(workflow, new RegExp("'" + column + "'"));
    assert.match(workflow, new RegExp('"' + column + '"'));
  }
  assert.match(workflow, /pragma_table_info\('user'\)/);
  assert.match(workflow, /registration\/profile bootstrap columns/);
});

test("workflow cannot deploy the Worker or modify DNS, domains, or secrets", () => {
  assert.doesNotMatch(workflow, /wrangler\s+deploy\b/i);
  assert.doesNotMatch(workflow, /wrangler\s+secret\s+(put|bulk|delete)\b/i);
  assert.doesNotMatch(workflow, /d1\s+(create|delete)\b/i);
  assert.doesNotMatch(workflow, /workers\s+(domains|routes)\b/i);
  assert.doesNotMatch(workflow, /mvdczyitbkxkldjughor/);
  assert.match(workflow, /contents: read/);
});

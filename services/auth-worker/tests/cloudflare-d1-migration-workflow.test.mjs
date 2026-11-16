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
  assert.match(workflow, /paths:\n      - "\.github\/auth-ops\/APPLY-STAGING-D1-0008"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*push/);
  assert.match(workflow, /APPLY-STAGING-D1-0008/);
  assert.match(workflow, /APPLY-TO-sykabelajar-auth-poc/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /migrationSha256/);
  assert.match(workflow, /c569ffe20088ba124c2eb1da19790b717715894dac7a373dd8a071b0aab2b778/);
  assert.match(workflow, /2d773a74cebf9f00ed95e42aa704855e3639827820875792874de5093519391f/);
  assert.match(workflow, /e29ecb4655bac013ded7db40051045d9c2507d3f7790b365cdbb8e2dfe1fd1b1/);
  assert.match(workflow, /b794cd2b217158ec2f5d540a646d0655c7504258b0bd49eda9131d5585233df7/);
  assert.match(workflow, /e2a7a59e026c59f190076765f294878856cc7b3413a3741cc58055b7d1ca4297/);
  assert.match(workflow, /f0bf29fcaebf416ddcdb3758000dc1fbecce7b7ee6be5bbd2e6e10e17755a158/);
  assert.match(workflow, /dcc1d9a18aff172a04305f932a8c4066393343fe8feb274421203cafb342bbe2/);
  assert.match(workflow, /fc51689b68c4750d1f2e0592c27e4a15e6c3acaab0e89e40e51e63e6890d2d71/);
  assert.match(workflow, /0011_add_github_social_provider\.sql/);
  assert.match(workflow, /separately authorized and recorded/);
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
    "0007_managed_social_login_providers.sql",
    "0008_add_staging_oauth_callback.sql",
    "0009_auth_runtime_settings.sql",
    "0010_multi_provider_email_routing.sql",
    "0011_add_github_social_provider.sql",
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
  assert.match(workflow, /auth_social_provider_settings/);
  assert.match(workflow, /auth_social_provider_meta/);
  assert.match(workflow, /auth-d1-social-provider-columns.json/);
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

test("legacy broad staging migration is owner-only and cannot bypass email migrations 0009–0010", () => {
  assert.match(workflow, /github\.actor == 'taufx98'/);
  assert.match(workflow, /GITHUB_ACTOR.*taufx98/);
  assert.match(workflow, /f0bf29fcaebf416ddcdb3758000dc1fbecce7b7ee6be5bbd2e6e10e17755a158/);
  assert.match(workflow, /dcc1d9a18aff172a04305f932a8c4066393343fe8feb274421203cafb342bbe2/);
  assert.match(workflow, /0009_auth_runtime_settings\.sql/);
  assert.match(workflow, /0010_multi_provider_email_routing\.sql/);
  assert.match(workflow, /Confirm migrations 0009–0010 were separately authorized and recorded/);
  assert.match(workflow, /SELECT name FROM d1_migrations/);
  assert.match(workflow, /separately owner-authorized 0009\/0010/);
  assert.match(workflow, /expected\.length !== 23/);
  assert.match(workflow, /auth_email_provider_accounts/);
  assert.match(workflow, /auth_email_provider_settings/);
});

test("workflow cannot deploy the Worker or modify DNS, domains, or secrets", () => {
  assert.doesNotMatch(workflow, /wrangler\s+deploy\b/i);
  assert.doesNotMatch(workflow, /wrangler\s+secret\s+(put|bulk|delete)\b/i);
  assert.doesNotMatch(workflow, /d1\s+(create|delete)\b/i);
  assert.doesNotMatch(workflow, /workers\s+(domains|routes)\b/i);
  assert.doesNotMatch(workflow, /mvdczyitbkxkldjughor/);
  assert.match(workflow, /contents: read/);
});

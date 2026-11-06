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

test("remote D1 schema migration is manual-dispatch only", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /CONFIRMATION.*inputs\.confirmation/);
  assert.match(workflow, /APPLY-TO-sykabelajar-auth-poc/);
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
  ]) {
    assert.ok(workflow.includes(file), "missing migration guard for " + file);
  }
  assert.match(workflow, /d1 migrations list sykabelajar-auth-poc --remote/);
  assert.match(workflow, /d1 migrations apply sykabelajar-auth-poc --remote/);
  assert.match(workflow, /d1 execute sykabelajar-auth-poc --remote --json/);
  assert.match(workflow, /auth_email_accounts/);
  assert.match(workflow, /oauthClient/);
});

test("workflow cannot deploy the Worker or modify DNS, domains, or secrets", () => {
  assert.doesNotMatch(workflow, /wrangler\s+deploy\b/i);
  assert.doesNotMatch(workflow, /wrangler\s+secret\s+(put|bulk|delete)\b/i);
  assert.doesNotMatch(workflow, /d1\s+(create|delete)\b/i);
  assert.doesNotMatch(workflow, /workers\s+(domains|routes)\b/i);
  assert.doesNotMatch(workflow, /mvdczyitbkxkldjughor/);
  assert.match(workflow, /contents: read/);
});

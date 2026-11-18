import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const retiredWorkflow = read("../../../.github/workflows/auth-cloudflare-production-worker-promote.yml");
const createWorkflow = read("../../../.github/workflows/auth-cloudflare-production-worker-create.yml");
const productionConfig = read("../wrangler.production.toml");
const stagingConfig = read("../wrangler.toml");

test("the previous same-Worker Production promotion remains disabled", () => {
  assert.match(retiredWorkflow, /if: \$\{\{ false \}\}/);
  assert.match(retiredWorkflow, /Disabled: the previous workflow would replace the staging Worker/);
  assert.match(productionConfig, /^name = "sykabelajar-auth-prod"$/m);
  assert.match(stagingConfig, /^name = "sykabelajar-auth-poc"$/m);
  assert.match(productionConfig, /^pattern = "auth-prod\.sykabelajar\.my\.id"$/m);
  assert.match(stagingConfig, /^pattern = "auth\.sykabelajar\.my\.id"$/m);
});

test("isolated Production Worker creation requires exact owner authorization", () => {
  assert.match(createWorkflow, /^on:\n  push:/m);
  assert.match(createWorkflow, /\.github\/auth-ops\/CREATE-PRODUCTION-AUTH-WORKER-0001/);
  assert.match(createWorkflow, /CREATE-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod/);
  assert.match(createWorkflow, /github\.actor == 'taufx98'/);
  assert.match(createWorkflow, /refs\/heads\/security\/auth-poc-stage-1/);
  assert.match(createWorkflow, /github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
  assert.match(createWorkflow, /cancel-in-progress: false/);
  assert.doesNotMatch(createWorkflow, /^  pull_request:/m);
});

test("creation preflight locks the correct Production target and proves staging remains untouched", () => {
  assert.match(createWorkflow, /scriptName = "sykabelajar-auth-prod"/);
  assert.match(createWorkflow, /6d4dc7b5-8e71-4fdc-9cda-3230e49951c7/);
  assert.match(createWorkflow, /7a4f9008-a1c6-42b6-8a04-abde12699248/);
  assert.match(createWorkflow, /auth-prod\.sykabelajar\.my\.id/);
  assert.match(createWorkflow, /auth\.sykabelajar\.my\.id/);
  assert.match(createWorkflow, /Staging Worker must exist exactly once/);
  assert.match(createWorkflow, /The accepted staging hostname must remain paired with the staging Worker/);
  assert.match(createWorkflow, /Staging Worker is not bound to the accepted staging D1/);
  assert.match(createWorkflow, /Production Worker must not exist before first creation/);
  assert.match(createWorkflow, /Production hostname is already attached; refusing to reassign or overwrite it/);
  assert.match(createWorkflow, /Production D1 migrations must be exactly 0000–0011/);
  assert.match(createWorkflow, /Production schema 0000–0011/);
  assert.match(createWorkflow, /zero identities\/credentials\/provider accounts/);
});

test("Production remains closed to public signup and Supabase provisioning during Worker creation", () => {
  assert.match(productionConfig, /^AUTH_SIGNUP_DISABLED = "true"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENABLED = "false"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENV = "production"$/m);
  assert.match(createWorkflow, /Production signup must remain closed/);
  assert.match(createWorkflow, /emailVerificationRequired:true/);
  assert.match(createWorkflow, /publicSignup:"closed"/);
  assert.match(createWorkflow, /frontendSwitch:"not performed"/);
});

test("creation generates fresh Production-only secrets without deleting staging secrets", () => {
  assert.match(createWorkflow, /randomBytes\(32\)/);
  for (const name of ["BETTER_AUTH_SECRET", "AUTH_PROVIDER_ENCRYPTION_KEY", "AUTH_EMAIL_ENCRYPTION_KEY"]) {
    assert.ok(createWorkflow.includes(name), "fresh Production-only secret missing: " + name);
  }
  assert.match(createWorkflow, /stagingWorkerSecretsChanged: false/);
  assert.match(createWorkflow, /stagingWorkerAndD1:"verified unchanged"/);
  assert.doesNotMatch(createWorkflow, /workers\/scripts\/sykabelajar-auth-poc\/secrets/);
  assert.doesNotMatch(createWorkflow, /DELETE\s+.*sykabelajar-auth-poc/i);
  assert.match(createWorkflow, /secretValuesReadOrLogged: false/);
});

test("post-creation smoke checks prove Production issuer/JWKS/PKCE/CORS and signup remains blocked", () => {
  assert.match(createWorkflow, /await get\("\/healthz"\)/);
  assert.match(createWorkflow, /discovery\.issuer,origin\+"\/api\/auth"/);
  assert.match(createWorkflow, /code_challenge_methods_supported/);
  assert.match(createWorkflow, /key\.alg==="ES256"/);
  assert.match(createWorkflow, /attacker\.example/);
  assert.match(createWorkflow, /providers\.body\.emailVerificationRequired,true/);
  assert.match(createWorkflow, /assert\.equal\(signup\.status,503/);
  assert.match(createWorkflow, /stagingWorkerAndD1:"verified unchanged"/);
  assert.match(createWorkflow, /stagingHostname:"preserved"/);
});

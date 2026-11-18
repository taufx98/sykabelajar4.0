import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-supabase-production-oidc.yml", import.meta.url),
  "utf8",
);

test("Production Custom OIDC registration is manual and exact-target guarded", () => {
  assert.match(workflow, /^on:\n  push:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /REGISTER-PRODUCTION-OIDC-mvdczyitbkxkldjughor/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /projectRef = "mvdczyitbkxkldjughor"/);
  assert.match(workflow, /expectedProjectName = "sykabelajar_db2"/);
  assert.match(workflow, /expectedOrganizationId = "qdmwatwyyrdjbrvxtcfu"/);
  assert.match(workflow, /https:\/\/auth-prod\.sykabelajar\.my\.id\/api\/auth/);
  assert.match(workflow, /code_challenge_methods_supported/);
  assert.match(workflow, /key\.alg === "ES256"/);
  assert.match(workflow, /registrationAttempted/);
  assert.match(workflow, /registered\.length !== 1/);
  assert.doesNotMatch(workflow, /ydamszdfsxqisanazdkb|staging\.sykabelajar\.my\.id/);
  assert.doesNotMatch(workflow, /DELETE|apply_migration|auth\.users/i);
});

test("Production issuer registration cannot run automatically on branch pushes", () => {
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /REGISTER-PRODUCTION-OIDC-0001/);
  assert.match(workflow, /exact Production OIDC marker/);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /type: string/);
});

test("Production OIDC workflow reports the exact minimum scoped PAT permissions without exposing token data", () => {
  assert.match(workflow, /Project Settings: Read/);
  assert.match(workflow, /Auth Config: Read\/Write/);
  assert.match(workflow, /Auth Config: Read \(or Read\/Write\)/);
  assert.match(workflow, /project mvdczyitbkxkldjughor/);
  assert.match(workflow, /its owner has project access/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*SUPABASE_ACCESS_TOKEN|SUPABASE_ACCESS_TOKEN[^\n]*console\.log/i);
});

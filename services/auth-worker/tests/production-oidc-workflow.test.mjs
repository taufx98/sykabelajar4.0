import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-supabase-production-oidc.yml", import.meta.url),
  "utf8",
);

test("Production Custom OIDC registration is manual and exact-target guarded", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/security\/auth-poc-stage-1'/);
  assert.match(workflow, /REGISTER-PRODUCTION-OIDC-mvdczyitbkxkldjughor/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /projectRef = "mvdczyitbkxkldjughor"/);
  assert.match(workflow, /expectedProjectName = "sykabelajar_db2"/);
  assert.match(workflow, /expectedOrganizationId = "qdmwatwyyrdjbrvxtcfu"/);
  assert.match(workflow, /https:\/\/auth\.sykabelajar\.my\.id\/api\/auth/);
  assert.match(workflow, /code_challenge_methods_supported/);
  assert.match(workflow, /key\.alg === "ES256"/);
  assert.match(workflow, /registrationAttempted/);
  assert.match(workflow, /registered\.length !== 1/);
  assert.doesNotMatch(workflow, /ydamszdfsxqisanazdkb|staging\.sykabelajar\.my\.id/);
  assert.doesNotMatch(workflow, /DELETE|apply_migration|auth\.users/i);
});

test("Production issuer registration cannot run automatically on branch pushes", () => {
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /type: string/);
});

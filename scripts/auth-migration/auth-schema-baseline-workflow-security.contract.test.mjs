import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflow = readFileSync(
  path.join(root, ".github/workflows/auth-schema-baseline.yml"),
  "utf8",
);
const prWorkflow = readFileSync(
  path.join(root, ".github/workflows/auth-schema-pr-contracts.yml"),
  "utf8",
);

const trigger = workflow.match(/^on:\n([\s\S]*?)^permissions:\n/m)?.[1];
assert.ok(trigger, "Production schema baseline must have a readable trigger block.");

const events = [...trigger.matchAll(/^  ([a-z_]+):\s*$/gm)].map((match) => match[1]);
assert.deepEqual(events, ["push", "workflow_dispatch"],
  "Secret-bearing Production schema export may run only on trusted push/manual events.");
assert.doesNotMatch(trigger, /^  pull_request(?:_target)?:/m,
  "Production database secrets must never be exposed to pull-request workflow code.");
assert.doesNotMatch(trigger, /^  workflow_run:/m,
  "A workflow_run trigger must not execute the secret-bearing exporter against a ref chosen by another workflow.");

const push = trigger.slice(trigger.indexOf("  push:"), trigger.indexOf("  workflow_dispatch:"));
const branchBlock = push.match(/^    branches:\n([\s\S]*?)^    paths:/m)?.[1];
assert.ok(branchBlock, "Trusted push branch allowlist is missing.");
assert.deepEqual(
  [...branchBlock.matchAll(/^      - (.+)$/gm)].map((match) => match[1].replaceAll('"', "")),
  ["security/auth-poc-stage-1"],
  "Production schema export may run only after a push to the reviewed auth migration base.",
);

assert.match(
  workflow,
  /^  schema-only-restore:\n    # workflow_dispatch can select any ref; only the reviewed migration base may receive Production credentials\.\n    if: \$\{\{ github\.actor == 'taufx98' && github\.ref == 'refs\/heads\/security\/auth-poc-stage-1' \}\}$/m,
  "The secret-bearing job must reject manual dispatches from every non-trusted ref.",
);
assert.match(workflow, /SUPABASE_DB_URL:\s*\$\{\{\s*secrets\.SUPABASE_DB_URL\s*\}\}/,
  "The guarded baseline job must keep using the repository secret rather than embedding credentials.");
assert.match(workflow, /bash scripts\/auth-migration\/export-schema-baseline\.sh/,
  "The trusted baseline must still execute the schema-only exporter.");
assert.match(workflow, /if: steps\.credentials\.outputs\.available == 'true'\n        env:\n          SUPABASE_DB_URL:/,
  "The exporter must be conditional on validated credential presence.");
assert.match(workflow, /^permissions:\n  contents: read$/m,
  "The schema-only baseline must keep read-only repository permissions.");
assert.doesNotMatch(workflow, /pull_request_target|workflow_run:/,
  "No privileged PR-target or workflow-run event may be added to the secret-bearing workflow.");
for (const requiredPath of [
  "docs/security/AUTH-STAGE-7-POST-STAGE3-USER-RPC-ISSUER-GUARDS-DRAFT.sql",
  "docs/security/AUTH-STAGE-7-SYSTEM-LOG-COLLECTOR-ACL-RESTORE.sql",
  "scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.contract.test.mjs",
  "scripts/auth-migration/stage7-post-stage3-user-rpc-issuer-guards.regression.sql",
]) {
  assert.ok(push.includes(requiredPath),
    "A Stage 7 security baseline input must trigger the read-only Production schema baseline: " + requiredPath);
}

assert.match(prWorkflow, /^on:\n  pull_request:/m,
  "PR contract checks must remain available on pull requests.");
assert.match(prWorkflow, /^permissions:\n  contents: read$/m,
  "PR contract checks must use read-only repository permissions.");
assert.doesNotMatch(prWorkflow, /secrets\.|SUPABASE_DB_URL|CLOUDFLARE_API_TOKEN/,
  "The PR-safe contract workflow must not receive Production or Cloudflare secrets.");

console.log("Production schema workflow security contract passed: no PR trigger, trusted-branch-only secret job, read-only repository permissions.");

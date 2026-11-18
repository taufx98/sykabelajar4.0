import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const staging = readFileSync(path.join(root, "services/auth-worker/wrangler.toml"), "utf8");
const production = readFileSync(path.join(root, "services/auth-worker/wrangler.production.toml"), "utf8");
const createWorkflow = readFileSync(path.join(root, ".github/workflows/auth-cloudflare-production-worker-create.yml"), "utf8");
const retiredWorkflow = readFileSync(path.join(root, ".github/workflows/auth-cloudflare-production-worker-promote.yml"), "utf8");
const oidcWorkflow = readFileSync(path.join(root, ".github/workflows/auth-supabase-production-oidc.yml"), "utf8");
const d1Workflow = readFileSync(path.join(root, ".github/workflows/auth-cloudflare-production-d1-migrate.yml"), "utf8");

const stagingD1 = "7a4f9008-a1c6-42b6-8a04-abde12699248";
const productionD1 = "6d4dc7b5-8e71-4fdc-9cda-3230e49951c7";
const stagingHost = "auth.sykabelajar.my.id";
const productionHost = "auth-prod.sykabelajar.my.id";
const productionIssuer = "https://" + productionHost + "/api/auth";

// The accepted staging identity endpoint must not be renamed or rebound.
assert.match(staging, /^name = "sykabelajar-auth-poc"$/m);
assert.match(staging, new RegExp("^database_id = \"" + stagingD1 + "\"$", "m"));
assert.match(staging, new RegExp('^pattern = "' + stagingHost.replaceAll(".", "\\.") + '"$', "m"));
assert.match(staging, /BETTER_AUTH_URL = "https:\/\/auth\.sykabelajar\.my\.id"/);

// Production must use a different Worker, D1 and issuer, while retaining fail-closed defaults.
assert.match(production, /^name = "sykabelajar-auth-prod"$/m);
assert.match(production, new RegExp("^database_id = \"" + productionD1 + "\"$", "m"));
assert.match(production, new RegExp('^pattern = "' + productionHost.replaceAll(".", "\\.") + '"$', "m"));
assert.match(production, /BETTER_AUTH_URL = "https:\/\/auth-prod\.sykabelajar\.my\.id"/);
assert.match(production, /AUTH_SIGNUP_DISABLED = "true"/);
assert.match(production, /SUPABASE_PROVISIONING_ENABLED = "false"/);
assert.match(production, /SUPABASE_PROVISIONING_ENV = "production"/);
assert.doesNotMatch(production, /ydamszdfsxqisanazdkb|staging\.sykabelajar\.my\.id|DEV_APP_ORIGIN|auth\.sykabelajar\.my\.id/);

// The only enabled Worker-create action requires exact owner/branch authorization and one explicit marker.
assert.match(createWorkflow, /CREATE-PRODUCTION-AUTH-WORKER-0001/);
assert.match(createWorkflow, /CREATE-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod/);
assert.match(createWorkflow, /github.actor == 'taufx98'/);
assert.match(createWorkflow, /refs\/heads\/security\/auth-poc-stage-1/);
assert.match(createWorkflow, /github.event_name == 'workflow_dispatch' \|\| github.event_name == 'push'/);
assert.match(createWorkflow, /test "\$CONFIRMATION" = "CREATE-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod"/);
assert.match(createWorkflow, /sykabelajar-auth-poc/);
assert.match(createWorkflow, new RegExp(stagingD1));
assert.match(createWorkflow, new RegExp(productionD1));
assert.match(createWorkflow, new RegExp(stagingHost.replaceAll(".", "\\.")));
assert.match(createWorkflow, new RegExp(productionHost.replaceAll(".", "\\.")));
assert.match(createWorkflow, /Staging Worker must exist exactly once/);
assert.match(createWorkflow, /The accepted staging hostname must remain paired/);
assert.match(createWorkflow, /Staging Worker is not bound to the accepted staging D1/);
assert.match(createWorkflow, /Production Worker and hostname do not already exist/);
assert.match(createWorkflow, /stagingWorkerSecretsChanged: false/);
assert.match(createWorkflow, /stagingWorkerAndD1:"verified unchanged"/);
assert.match(createWorkflow, /Production signup must remain closed/);
assert.match(createWorkflow, /emailVerificationRequired:true/);
assert.doesNotMatch(createWorkflow, /workers\/scripts\/sykabelajar-auth-poc\/secrets/);
assert.doesNotMatch(createWorkflow, /DELETE\s+.*sykabelajar-auth-poc/i);

// The previous in-place promotion must be disabled so it cannot rebind the live staging Worker.
assert.match(retiredWorkflow, /if: \$\{\{ false \}\}/);
assert.match(retiredWorkflow, /would replace the staging Worker/);

// All Production-side issuer registration and DB2 SQL guards must use auth-prod, never the staging issuer.
assert.match(oidcWorkflow, new RegExp(productionIssuer.replaceAll(".", "\\.")));
assert.doesNotMatch(oidcWorkflow, new RegExp("https://" + stagingHost.replaceAll(".", "\\.") + "/api/auth"));
for (const file of [
  "docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql",
  "docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql",
  "docs/security/AUTH-STAGE-3-ROLLBACK-DRAFT.sql",
  "scripts/auth-migration/stage3-production-schema-regression.sql",
  "scripts/auth-migration/stage3-issuer-guard-regression.sql",
]) {
  const sql = readFileSync(path.join(root, file), "utf8");
  assert.ok(sql.includes(productionIssuer), file + " must pin the Production issuer to auth-prod");
  assert.ok(!sql.includes("https://" + stagingHost + "/api/auth"), file + " must not accept the staging issuer for Production DB2");
}
assert.match(d1Workflow, /sykabelajar-auth-prod/);
assert.match(d1Workflow, new RegExp(productionD1));
assert.match(d1Workflow, /migrations-production/);

console.log("Production Worker isolation contract passed: staging Worker/D1/issuer retained, dedicated Production Worker/issuer pinned, public signup closed, and in-place promotion disabled.");

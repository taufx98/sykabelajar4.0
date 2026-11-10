import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-pages-preview-config-update.yml", import.meta.url),
  "utf8",
);

test("Pages update is pinned to the migration branch, exact repo, domain and marker", () => {
  assert.ok(workflow.includes("CONFIGURE-AUTH-PAGES-PREVIEW-0001"));
  assert.ok(workflow.includes("refs/heads/security/auth-poc-stage-1"));
  assert.ok(workflow.includes('before?.source?.config?.owner !== "taufx98"'));
  assert.ok(workflow.includes('before?.source?.config?.repo_name !== "sykabelajar4.0"'));
  assert.ok(workflow.includes('before.domains.includes(stagingDomain)'));
  assert.ok(workflow.includes('before.production_branch === branch'));
});

test("Pages update changes Preview only and preserves all existing Preview configuration", () => {
  assert.ok(workflow.includes('const body = { deployment_configs: { preview: nextPreview } };'));
  assert.ok(workflow.includes('const nextPreview = { ...preview, env_vars: merged };'));
  assert.ok(workflow.includes('const merged = { ...existing };'));
  assert.ok(workflow.includes("sharedPreviewSupabaseUrlPreserved"));
  assert.ok(workflow.includes("sharedPreviewSupabaseKeyPreserved"));
  assert.ok(workflow.includes("productionConfigUnchanged"));
  assert.ok(workflow.includes("productionBranchUnchanged"));
  assert.ok(workflow.includes("productionTouched: false"));
  assert.ok(workflow.includes("dnsTouched: false"));
  assert.ok(workflow.includes("oauthCredentialsTouched: false"));
  assert.ok(workflow.includes("emailCredentialsTouched: false"));
  assert.doesNotMatch(workflow, /deployment_configs:\s*\{\s*production:/);
});

test("Pages Preview Better Auth values are exact staging endpoints and key comes from pinned Worker config", () => {
  assert.ok(workflow.includes('"https://ydamszdfsxqisanazdkb.supabase.co"'));
  assert.ok(workflow.includes('"https://auth.sykabelajar.my.id"'));
  assert.ok(workflow.includes('VITE_BETTER_AUTH_FRONTEND_ENABLED: "true"'));
  assert.ok(workflow.includes('VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY: publishableKey'));
  assert.ok(workflow.includes('readFileSync("services/auth-worker/wrangler.toml"'));
  assert.ok(workflow.includes('startsWith("sb_publishable_")'));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-pages-preview-config-preflight.yml", import.meta.url),
  "utf8",
);

test("Pages preflight is pinned to the migration branch, exact repository, and matching one-time marker", () => {
  assert.ok(workflow.includes(".github/auth-ops/CHECK-AUTH-PAGES-PREVIEW-CONFIG-0005"));
  assert.ok(workflow.includes('CHECK-AUTH-PAGES-PREVIEW-CONFIG-0005'));
  assert.ok(workflow.includes("actions/checkout@v7"));
  assert.equal((workflow.match(/^    steps:$/gm) ?? []).length, 1);
  assert.match(workflow, /security\/auth-poc-stage-1/);
  assert.match(workflow, /sykabelajar4\.pages\.dev/);
  assert.match(workflow, /source\?\.config\?\.owner === "taufx98"/);
  assert.match(workflow, /source\?\.config\?\.repo_name === "sykabelajar4\.0"/);
  assert.match(workflow, /staging\.sykabelajar\.my\.id/);
});

test("Pages preflight checks the staging Supabase and Better Auth flag without printing values", () => {
  for (const name of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_BETTER_AUTH_SUPABASE_URL",
    "VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY",
    "VITE_BETTER_AUTH_FRONTEND_ENABLED",
    "VITE_AUTH_WORKER_URL",
  ]) assert.ok(workflow.includes(name));
  assert.ok(workflow.includes("ydamszdfsxqisanazdkb.supabase.co"));
  assert.ok(workflow.includes("auth.sykabelajar.my.id"));
  assert.match(workflow, /sharedPreviewSupabaseConfigPreserved/);
  assert.match(workflow, /sharedSupabasePublishableKeyConfigured/);
  assert.match(workflow, /stagingSupabaseUrlTargetsIsolatedProject/);
  assert.match(workflow, /stagingPublishableKeyConfigured/);
  assert.match(workflow, /previewVariableNames: names/);
  assert.match(workflow, /Never print variable values, key material, credentials or raw API responses/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*(?:value\(|envVars\[|publishableKey|token)/i);
});

test("Pages preflight is read-only and has no create/update/delete calls", () => {
  assert.match(workflow, /noPagesOrDnsMutation: true/);
  assert.match(workflow, /readOnly: true/);
  assert.doesNotMatch(workflow, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(workflow, /dns_records\//);
  assert.match(workflow, /CHECK-BETTER-AUTH-PAGES-PREVIEW-CONFIG/);
});

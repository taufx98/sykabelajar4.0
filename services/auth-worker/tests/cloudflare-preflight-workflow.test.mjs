import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/auth-cloudflare-preflight.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

test("Cloudflare preflight reads auth and Pages staging DNS records without mutating DNS", () => {
  assert.match(workflow, /dns_records\?name=auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /dns_records\?name=staging\.sykabelajar\.my\.id/);
  assert.match(workflow, /workers\/domains\?hostname=auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /pages\/projects/);
  assert.match(workflow, /pagesCertificateStatus/);
  assert.match(workflow, /cloudflare-dns\.com\/dns-query/);
  assert.match(workflow, /authA, authAAAA, authCNAME/);
  assert.match(workflow, /stagingA, stagingAAAA, stagingCNAME/);
  assert.doesNotMatch(workflow, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(workflow, /dns_records["'][^\n]*(?:POST|PATCH|DELETE)/i);
});

test("preflight output contains only DNS metadata and never credentials", () => {
  assert.match(workflow, /type: row\.type, name: row\.name, content: row\.content, proxied: row\.proxied/);
  assert.match(workflow, /errorCodes/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*(?:token|secret|authorization)/i);
});

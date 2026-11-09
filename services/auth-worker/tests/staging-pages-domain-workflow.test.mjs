import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/auth-pages-staging-domain.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

test("Pages domain attachment is restricted to the Better Auth migration branch and exact hostname", () => {
  assert.match(workflow, /security\/auth-poc-stage-1/);
  assert.match(workflow, /sykabelajar4/);
  assert.match(workflow, /security-auth-poc-stage-1\.sykabelajar4\.pages\.dev/);
  assert.match(workflow, /staging\.sykabelajar\.my\.id/);
  assert.match(workflow, /ATTACH-STAGING-PAGES-DOMAIN-0001/);
  assert.match(workflow, /ATTACH-staging\.sykabelajar\.my\.id-to-security-auth-poc-stage-1/);
});

test("DNS changes fail closed and only point the exact CNAME to the proxied branch alias", () => {
  assert.match(workflow, /matchingZones\.length !== 1/);
  assert.match(workflow, /records\.length > 1/);
  assert.match(workflow, /record\.type !== "CNAME"/);
  assert.match(workflow, /allowedTargets/);
  assert.match(workflow, /record\.proxied !== true/);
  assert.match(workflow, /content: branchAlias/);
  assert.match(workflow, /proxied: true/);
  assert.match(workflow, /no later mutation was attempted/);
  assert.doesNotMatch(workflow, /method:\s*"DELETE"|\bDELETE\b|dns_records\/scan/i);
  assert.match(workflow, /noWorkerDeployment: true/);
  assert.match(workflow, /noD1Mutation: true/);
});

test("Pages custom domain is attached to the exact project before DNS verification", () => {
  assert.match(workflow, /\/pages\/projects\/.*\/domains/);
  assert.match(workflow, /"POST"/);
  assert.match(workflow, /"DNS/);
  assert.match(workflow, /domainDetail\.status/);
});

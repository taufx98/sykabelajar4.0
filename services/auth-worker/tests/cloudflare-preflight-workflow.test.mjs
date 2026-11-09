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
  assert.match(workflow, /resolveDns\("sykabelajar\.my\.id", "NS"\)/);
  assert.match(workflow, /import \{ execFileSync \} from "node:child_process"/);
  assert.ok(workflow.includes('"@" + parentServer, "+norecurse", "+noall", "+authority",'));
  assert.ok(workflow.includes('"sykabelajar.my.id", "NS"'));
  assert.match(workflow, /parentPublishedDelegationNameservers/);
  assert.match(workflow, /parentDelegationMatchesCloudflare/);
  assert.match(workflow, /parentDelegationDsRecordCount/);
  assert.doesNotMatch(workflow, /publicParentNameservers:\\s*parentNS/);
  assert.match(workflow, /resolveDns\("sykabelajar\.my\.id", "DS"\)/);
  assert.match(workflow, /resolveDns\("my\.id", "NS"\)/);
  assert.match(workflow, /publicDelegation/);
  assert.match(workflow, /cloudflareZoneRecordInventory/);
  assert.match(workflow, /cloudflareZoneRecordTypeCounts/);
  assert.match(workflow, /rootMX, rootTXT/);
  assert.match(workflow, /wwwA, wwwAAAA, wwwCNAME/);
  assert.match(workflow, /emailCNAME/);
  assert.match(workflow, /txtRecordParity/);
  assert.match(workflow, /matchesCloudflareZone: mxParity/);
  assert.match(workflow, /valuesExposed: false/);
  assert.match(workflow, /dns_records\?per_page=100&page=1/);
  assert.doesNotMatch(workflow, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(workflow, /dns_records["'][^\n]*(?:POST|PATCH|DELETE)/i);
});

test("preflight output contains only DNS metadata and never credentials", () => {
  assert.match(workflow, /type: row\.type, name: row\.name, content: row\.content, proxied: row\.proxied/);
  assert.match(workflow, /errorCodes/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*(?:token|secret|authorization)/i);
});

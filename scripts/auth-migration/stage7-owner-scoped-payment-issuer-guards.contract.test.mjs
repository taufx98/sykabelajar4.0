import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const draft = read("docs/security/AUTH-STAGE-7-OWNER-SCOPED-PAYMENT-ISSUER-GUARDS-DRAFT.sql");
const regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");
const triage = JSON.parse(read("docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json"));

const targets = [
  {
    signature: "create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)",
    md5: "fa5e3bb6726bdf8d8b6768871c71ef97",
  },
  {
    signature: "create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)",
    md5: "7fae7e641d7bed2a24bacaf3724139e7",
  },
];

for (const target of targets) {
  const entry = triage.functions.find((fn) => fn.signature === target.signature);
  assert.ok(entry, "Missing exact 202-function inventory entry: " + target.signature);
  assert.equal(entry.sourceMd5, target.md5, "Production source fingerprint changed: " + target.signature);
  assert.equal(entry.owner, "postgres");
  assert.equal(entry.searchPathConfig[0], "search_path=public, private");
  assert.equal(entry.execute.anon, false);
  assert.equal(entry.execute.authenticated, true);
  assert.equal(entry.execute.serviceRole, true);
  assert.ok(draft.includes(target.md5), "Draft must fail closed on source drift: " + target.signature);
  assert.ok(draft.includes(target.signature), "Draft must preflight exact signature: " + target.signature);
}

assert.match(draft, /CREATE TEMP TABLE stage7_owner_scoped_payment_rpc_before/);
assert.match(draft, /pg_get_functiondef/);
assert.match(draft, /md5\(p\.prosrc\)/);
assert.match(draft, /private\.current_user_is_better_auth\(\)/);
assert.match(draft, /BETTER_AUTH_ISSUER_REQUIRED/);
assert.match(draft, /v_price := public\.get_collective_certificate_price\(\)/);
assert.match(draft, /STAGE7_PAYMENT_RPC_METADATA_OR_ACL_MUTATED/);
assert.match(draft, /STAGE7_PAYMENT_RPC_EXECUTE_BOUNDARY_MUTATED/);
assert.doesNotMatch(draft, /ALTER TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE public[.]/i,
  "This RPC draft must not mutate tables or application data.");
const aclStatements = draft.match(/^(?:REVOKE ALL PRIVILEGES ON FUNCTION|GRANT EXECUTE ON FUNCTION).*$/gm) ?? [];
assert.equal(aclStatements.length, 4, "Only the two reviewed function ACLs may be reconstructed.");
assert.equal(aclStatements.filter((line) => line.startsWith("REVOKE ALL PRIVILEGES ON FUNCTION")).length, 2);
assert.equal(aclStatements.filter((line) => line.startsWith("GRANT EXECUTE ON FUNCTION")).length, 2);
assert.ok(draft.includes("FROM PUBLIC, anon, authenticated, service_role;"));
assert.match(draft, /TO authenticated, service_role;/);
assert.match(draft, /STAGE7_PAYMENT_RPC_ACL_RESTORE_POSTCONDITION_FAILED/);
assert.match(draft, /STAGE7_PAYMENT_RPC_ACL_ENTRY_DRIFT/);

for (const marker of [
  "STAGE7_CERTIFICATE_OWNER_POSITIVE_FAILED",
  "STAGE7_CERTIFICATE_FOREIGN_OWNER_NOT_DENIED",
  "STAGE7_CERTIFICATE_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_ORGANIZER_OWNER_SCOPE_FAILED",
  "STAGE7_ORGANIZER_FOREIGN_MEMBER_NOT_DENIED",
  "STAGE7_ORGANIZER_LEGACY_ISSUER_NOT_DENIED",
  "STAGE7_ORGANIZER_ADMIN_OVERRIDE_FAILED",
]) {
  assert.ok(regression.includes(marker), "Missing disposable runtime assertion: " + marker);
}

assert.ok(workflow.includes("docs/security/AUTH-STAGE-7-OWNER-SCOPED-PAYMENT-ISSUER-GUARDS-DRAFT.sql"));
assert.ok(workflow.includes("scripts/auth-migration/stage7-owner-scoped-payment-issuer-guards.contract.test.mjs"));
assert.match(workflow, /Apply Stage 7 owner-scoped payment issuer guards to disposable restore only/);
assert.match(workflow, /Run Stage 3 trusted-issuer RLS acceptance on disposable restore/);
assert.match(workflow, /--file=\/baseline\/stage7-owner-scoped-payment-issuer-guards\.sql/);
assert.match(workflow, /echo "- Added issuer-first Better Auth checks to two owner-scoped checkout SECURITY DEFINER RPCs; no Production writes"/);

console.log("Stage 7 owner-scoped payment issuer guard contract passed: exact Production fingerprints, reconstructed exact disposable ACL, preserved function metadata, and rollback-only issuer/owner tests.");

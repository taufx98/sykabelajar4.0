import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const triage = JSON.parse(read("docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json"));
const identity = read("docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql");
const issuer = read("docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql");
const supplemental = read("docs/security/AUTH-STAGE-3-USER-RPC-ISSUER-GUARDS-DRAFT.sql");
const regression = read("scripts/auth-migration/stage3-issuer-guard-regression.sql");

const functions = triage.functions.filter((f) =>
  f.suggestedClassification === "better_auth_user" ||
  f.suggestedClassification === "worker_internal"
);
functions.push(
  { name: "create_collective_certificate_order", signature: "create_collective_certificate_order(uuid)" },
  { name: "create_product_order", signature: "create_product_order(uuid,integer)" },
);
assert.equal(functions.length, 68,
  "User-bound RPC scope must include 62 personal RPCs, four frontend diagnostics RPCs, and two account-bound order RPCs.");

const certificateOrderDefinition = definitionsFor(supplemental, "create_collective_certificate_order")[0] ?? "";
assert.ok(certificateOrderDefinition, "Missing guarded create_collective_certificate_order(uuid) replacement.");
assert.match(certificateOrderDefinition, /v_price numeric;/,
  "Certificate price must not be read in DECLARE before the issuer check.");
assert.doesNotMatch(certificateOrderDefinition, /v_price numeric := public\.get_collective_certificate_price\(\)/,
  "Certificate price initializer must be removed from DECLARE.");
assert.ok(
  certificateOrderDefinition.indexOf("private.current_user_is_better_auth()") <
    certificateOrderDefinition.indexOf("public.get_collective_certificate_price()"),
  "Better Auth issuer must be checked before reading certificate pricing.",
);

const supplementalNames = new Set([...supplemental.matchAll(
  /CREATE OR REPLACE FUNCTION public\.([a-z_][a-z0-9_]*)\s*\(/gi,
)].map((m) => m[1].toLowerCase()));

function definitionsFor(source, name) {
  // Function names are taken from the fixed snake_case catalog manifest.
  return [...source.matchAll(new RegExp(
    "CREATE OR REPLACE FUNCTION public\\." + name + "\\s*\\([\\s\\S]*?\\$function\\$;",
    "gi",
  ))].map((m) => m[0]);
}

const base = identity + "\n" + issuer;
assert.equal([...supplemental.matchAll(/CREATE OR REPLACE FUNCTION public\./g)].length, 65,
  "The supplemental draft must replace exactly 65 functions; the three previously hardened profile/referral RPCs remain in the earlier issuer draft.");
for (const alreadyGuarded of ["get_follow_status", "get_my_verified_referrals", "get_public_profile_social"]) {
  assert.equal(definitionsFor(base, alreadyGuarded).slice(-1).length, 1,
    "Previously hardened RPC must remain covered by the preceding Stage 3 draft: " + alreadyGuarded);
  assert.equal(definitionsFor(supplemental, alreadyGuarded).length, 0,
    "Do not overwrite the hardened function with its older Production definition: " + alreadyGuarded);
}
for (const name of new Set(functions.map((f) => f.name))) {
  const definitions = supplementalNames.has(name)
    ? definitionsFor(supplemental, name)
    : definitionsFor(base, name).slice(-1);
  const expectedOverloads = functions.filter((f) => f.name === name).length;
  assert.equal(definitions.length, expectedOverloads,
    "Missing exact overload definition(s): " + name);
  for (const definition of definitions) {
    assert.match(definition, /private\.current_user_is_better_auth\(\)/,
      "User-bound SECURITY DEFINER RPC must verify exact issuer and private.app_users identity_origin: " + name);
  }
}

// The later 65-function issuer draft also replaces this RPC. It must
// preserve the private-competition visibility/organizer boundary from the
// earlier SECURITY DEFINER draft, not merely add the Better Auth issuer gate.
const collectiveOptions = definitionsFor(supplemental, "get_collective_registration_options")[0] ?? "";
assert.ok(collectiveOptions, "missing supplemental collective-options RPC replacement");
assert.match(collectiveOptions, /private\.current_user_is_better_auth\(\)/);
assert.match(collectiveOptions, /visibility IS DISTINCT FROM 'PUBLIC'/);
assert.match(collectiveOptions, /private\.current_user_is_admin\(\)/);
assert.match(collectiveOptions, /private\.current_user_is_organizer_for\(v_comp\.organizer_id\)/);
assert.match(collectiveOptions, /RAISE EXCEPTION 'COMPETITION_NOT_FOUND'/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PRIVATE_COLLECTIVE_OPTIONS_ALLOWED/);
assert.match(regression, /STAGE3_OTHER_BETTER_AUTH_PUBLIC_COLLECTIVE_OPTIONS_FAILED/);

for (const fn of functions) {
  const signature = "public." + fn.signature;
  assert.ok(regression.includes("'" + signature + "'"),
    "Missing runtime issuer-boundary test for " + signature);
}
assert.match(supplemental, /CREATE TEMP TABLE stage3_user_rpc_acl_snapshot/);
assert.match(supplemental, /p\.proacl IS DISTINCT FROM old\.proacl/);
assert.match(supplemental, /STAGE3_USER_RPC_FUNCTION_METADATA_OR_ACL_DRIFT/);
assert.match(regression, /STAGE3_LEGACY_USER_RPC_NOT_DENIED/);
assert.match(regression, /STAGE3_BETTER_AUTH_USER_RPC_REJECTED/);
assert.match(regression, /v_count <> 68/);

console.log("Stage 3 issuer contract passed: 68 user-bound SECURITY DEFINER signatures use the Better Auth identity helper and are covered by legacy-denial/Better Auth-acceptance fixtures.");

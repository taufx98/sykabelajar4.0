import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

const functions = [
  ["public.admin_diagnose_organizer_voucher_delete(uuid)", "FROM anon;"],
  ["public.admin_evaluate_badges()", "FROM PUBLIC, anon;"],
  ["public.admin_update_system_error_status(uuid, text, text)", "FROM anon;"],
  ["public.get_follow_status(uuid, uuid)", "FROM PUBLIC, anon;"],
  ["public.reopen_system_error_incident(uuid, text)", "FROM anon;"],
];

test("only five shared-auth RPCs have anonymous EXECUTE removed", () => {
  for (const [signature, roleClause] of functions) {
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION " + signature + "\n  " + roleClause),
      "missing scoped revoke for " + signature,
    );
  }
  assert.doesNotMatch(sql, /REVOKE\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS/i);
});

test("ACL preflight validates owner, SECURITY DEFINER and prior trusted access", () => {
  assert.match(sql, /ISSUER_GUARD_FUNCTION_MISSING/);
  assert.match(sql, /ISSUER_GUARD_UNEXPECTED_OWNER_OR_KIND/);
  assert.match(sql, /ISSUER_GUARD_EXECUTE_BASELINE_DRIFT/);
  assert.match(sql, /has_function_privilege\('authenticated', v_function, 'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('service_role', v_function, 'EXECUTE'\)/);
});

test("ACL postflight denies anon and preserves authenticated plus service_role", () => {
  assert.match(sql, /ISSUER_GUARD_ANON_EXECUTE_REMAINS/);
  assert.match(sql, /ISSUER_GUARD_TRUSTED_EXECUTE_MISSING/);
  assert.match(sql, /has_function_privilege\('anon', v_function, 'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('authenticated', v_function, 'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('service_role', v_function, 'EXECUTE'\)/);
});

test("public-read and participant-token RPC grants are not included in this revoke list", () => {
  assert.doesNotMatch(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.(get_public_competitions|get_public_competition_results|list_collective_portal_competitions|verify_collective_portal_password|record_shop_promo_banner_event)/i,
  );
});

test("social profile summary is explicitly authenticated-only", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+TO authenticated;/);
  assert.doesNotMatch(sql, /REVOKE EXECUTE ON FUNCTION public\.get_public_profile_social\(uuid\)\s+FROM PUBLIC, anon;/);
});

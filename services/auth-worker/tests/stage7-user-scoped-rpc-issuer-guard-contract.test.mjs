import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

const regression = readFileSync(
  new URL("../../../scripts/auth-migration/stage3-issuer-guard-regression.sql", import.meta.url),
  "utf8",
);

const functions = [
  ["archive_my_order_history", "public.archive_my_order_history(", "AUTH_REQUIRED", "SET search_path TO 'public', 'pg_catalog'"],
  ["bulk_import_roster_students", "public.bulk_import_roster_students(", "AUTH_REQUIRED", "SET search_path TO 'public'"],
  ["cancel_my_pending_order", "public.cancel_my_pending_order(", "AUTH_REQUIRED", "SET search_path TO 'public', 'private', 'pg_catalog'"],
  ["claim_and_complete_daily_task", "public.claim_and_complete_daily_task(", "LOGIN_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["claim_daily_checkin", "public.claim_daily_checkin(", "LOGIN_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["claim_daily_task", "public.claim_daily_task(", "LOGIN_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["claim_organizer_voucher", "public.claim_organizer_voucher(", "AUTH_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["claim_rpc_recovery", "public.claim_rpc_recovery(", "AUTH_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["complete_daily_task", "public.complete_daily_task(", "LOGIN_REQUIRED", "SET search_path TO 'public', 'private'"],
  ["create_ad_banner_payment_order", "public.create_ad_banner_payment_order(", "AUTH_REQUIRED", "SET search_path TO 'public', 'private', 'pg_catalog'"],
];

function functionBody(marker) {
  const start = sql.lastIndexOf("CREATE OR REPLACE FUNCTION " + marker);
  assert.notEqual(start, -1, "missing issuer-guarded function " + marker);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing function terminator for " + marker);
  return sql.slice(start, end + "$function$;".length);
}

test("user-scoped RPC issuer guard follows the existing anonymous-login error check", () => {
  for (const [name, marker, oldAuthError, searchPath] of functions) {
    const body = functionBody(marker);
    const originalAuthCheck = body.indexOf(oldAuthError);
    const issuerCheck = body.indexOf("private.current_user_is_better_auth()");
    assert.ok(originalAuthCheck >= 0, name + " lost its original anonymous-login check");
    assert.ok(issuerCheck > originalAuthCheck, name + " must preserve AUTH_REQUIRED/LOGIN_REQUIRED before issuer check");
    assert.match(body, /RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED'/, name + " missing exact issuer error");
    assert.ok(body.includes(searchPath), name + " search_path changed");
    assert.match(body, /SECURITY DEFINER/i, name + " must preserve SECURITY DEFINER mode");
  }
});

test("existing user ownership and business predicates remain present", () => {
  const expectations = [
    ["archive_my_order_history", /WHERE id = p_order_id AND user_id = v_uid/i],
    ["bulk_import_roster_students", /teacher_user_id=v_uid/i],
    ["cancel_my_pending_order", /WHERE id = p_order_id AND user_id = v_uid/i],
    ["claim_and_complete_daily_task", /private\.is_daily_task_eligible\(u, p_task_id, v_claim_date\)/i],
    ["claim_daily_checkin", /WHERE user_id = u AND checkin_date = p_date/i],
    ["claim_daily_task", /private\.is_daily_task_eligible\(u, p_task_id, v_claim_date\)/i],
    ["claim_organizer_voucher", /organizer_members[\s\S]*?m\.user_id=auth\.uid\(\)/i],
    ["claim_rpc_recovery", /p_rpc_name !~ '\^\[a-zA-Z0-9_\]\{1,120\}\
    ["complete_daily_task", /WHERE task_id = p_task_id[\s\S]*?AND user_id = u/i],
    ["create_ad_banner_payment_order", /WHERE id=p_request_id and user_id=v_uid/i],
  ];

  for (const [name, marker, , ] of functions) {
    const body = functionBody(marker);
    const expected = expectations.find((item) => item[0] === name);
    assert.ok(expected, "missing business rule expectation for " + name);
    if (typeof expected[1] === "string") {
      assert.ok(body.includes(expected[1]), name + " business validation changed");
    } else {
      assert.match(body, expected[1], name + " business ownership/eligibility logic changed");
    }
  }
});

test("Stage 3 disposable regression rejects legacy issuer for all ten user RPCs", () => {
  assert.match(regression, /DO \$legacy_user_rpc_issuer_gate\$/);
  for (const [name] of functions) {
    assert.ok(
      regression.includes("STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:" + name),
      "missing legacy issuer regression for " + name,
    );
  }
  assert.match(regression, /SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED'/);
});

test("Stage 3 disposable regression accepts a Better Auth identity and reaches business validation", () => {
  assert.match(regression, /DO \$better_auth_user_rpc_issuer_gate\$/);
  for (const [name] of functions) {
    assert.ok(
      regression.includes("STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:" + name),
      "missing Better Auth acceptance regression for " + name,
    );
  }
});

test("the issuer draft is transactional and does not revoke these RPC grants", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  for (const [name] of functions) {
    assert.doesNotMatch(
      sql,
      new RegExp("REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\." + name + "\\s*\\(", "i"),
      name + " EXECUTE grants must remain unchanged in this user-identity pass",
    );
  }
});
/i],
    ["complete_daily_task", /WHERE task_id = p_task_id[\s\S]*?AND user_id = u/i],
    ["create_ad_banner_payment_order", /WHERE id=p_request_id and user_id=v_uid/i],
  ];

  for (const [name, marker, , ] of functions) {
    const body = functionBody(marker);
    const expected = expectations.find((item) => item[0] === name);
    assert.ok(expected, "missing business rule expectation for " + name);
    assert.match(body, expected[1], name + " business ownership/eligibility logic changed");
  }
});

test("Stage 3 disposable regression rejects legacy issuer for all ten user RPCs", () => {
  assert.match(regression, /DO \$legacy_user_rpc_issuer_gate\$/);
  for (const [name] of functions) {
    assert.ok(
      regression.includes("STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:" + name),
      "missing legacy issuer regression for " + name,
    );
  }
  assert.match(regression, /SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED'/);
});

test("Stage 3 disposable regression accepts a Better Auth identity and reaches business validation", () => {
  assert.match(regression, /DO \$better_auth_user_rpc_issuer_gate\$/);
  for (const [name] of functions) {
    assert.ok(
      regression.includes("STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:" + name),
      "missing Better Auth acceptance regression for " + name,
    );
  }
});

test("the issuer draft is transactional and does not revoke these RPC grants", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  for (const [name] of functions) {
    assert.doesNotMatch(
      sql,
      new RegExp("REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\." + name + "\\s*\\(", "i"),
      name + " EXECUTE grants must remain unchanged in this user-identity pass",
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json", import.meta.url),
  "utf8",
));
const draft = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);
const regression = readFileSync(
  new URL("../../../scripts/auth-migration/stage3-issuer-guard-regression.sql", import.meta.url),
  "utf8",
);

const publicRpcExpected = new Map([
  ["start_collective_linear_exam_attempt(uuid,text)", {
    hash: "e0cb760153c8d32cfc3a4dd7a094bf3f",
    returns: "jsonb",
    language: "plpgsql",
  }],
  ["get_collective_linear_exam_state(uuid,text)", {
    hash: "6e8de1b7cf650fe44ef470bc6a7cdb97",
    returns: "jsonb",
    language: "plpgsql",
  }],
  ["save_collective_linear_exam_draft(uuid,text,uuid,jsonb)", {
    hash: "c00ff9db0800c4ebad0197ce8f49f90a",
    returns: "jsonb",
    language: "plpgsql",
  }],
  ["answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)", {
    hash: "127d65f07194685cc631e2a934a762b1",
    returns: "jsonb",
    language: "plpgsql",
  }],
  ["skip_collective_linear_exam_question(uuid,text)", {
    hash: "9db307e948270835d17b305d5609d6d4",
    returns: "jsonb",
    language: "plpgsql",
  }],
]);

function triage(signature) {
  const entry = inventory.functions.find((item) => item.signature === signature);
  assert.ok(entry, "missing Production triage signature " + signature);
  return entry;
}

test("five collective linear-exam RPCs match exact immutable Production fingerprints and token ACLs", () => {
  for (const [signature, expected] of publicRpcExpected) {
    const entry = triage(signature);
    assert.equal(entry.sourceMd5, expected.hash);
    assert.equal(entry.owner, "postgres");
    assert.deepEqual(entry.searchPathConfig, ['search_path=""']);
    assert.equal(entry.returns, expected.returns);
    assert.equal(entry.language, expected.language);
    assert.equal(entry.suggestedClassification, "participant_portal_token");
    assert.equal(entry.execute.anon, true);
    assert.equal(entry.execute.authenticated, true);
    assert.equal(entry.execute.serviceRole, true);
    assert.ok(entry.acl.includes("anon=X/postgres"));
    assert.ok(entry.acl.includes("authenticated=X/postgres"));
    assert.ok(entry.acl.includes("service_role=X/postgres"));
    assert.equal(entry.acl.some((grant) => grant.startsWith("=X/")), false);
  }
});

test("every state and mutation RPC delegates access to the same attempt-token assertion", () => {
  for (const signature of [
    "get_collective_linear_exam_state(uuid,text)",
    "save_collective_linear_exam_draft(uuid,text,uuid,jsonb)",
    "answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)",
    "skip_collective_linear_exam_question(uuid,text)",
  ]) {
    const entry = triage(signature);
    assert.match(entry.sourceExcerpt, /private\.assert_collective_linear_exam_access\s*\(/);
  }
  const start = triage("start_collective_linear_exam_attempt(uuid,text)");
  assert.match(start.sourceExcerpt, /private\.collective_session_participant\s*\(/);
  assert.match(start.sourceExcerpt, /COLLECTIVE_SESSION_INVALID/);
});

test("Stage 3 preflight pins all five public RPCs and both private token helpers", () => {
  const marker = "DO $stage7_collective_linear_exam_token_rpc_preflight$";
  const start = draft.indexOf(marker);
  const end = draft.indexOf("$stage7_collective_linear_exam_token_rpc_preflight$;", start);
  assert.ok(start >= 0 && end > start);
  const preflight = draft.slice(start, end);

  for (const expected of publicRpcExpected.values()) {
    assert.ok(preflight.includes(expected.hash), "missing public Production hash " + expected.hash);
  }
  for (const markerHash of [
    "df41031f29e376c9b4d5cb8966a09028",
    "6d794ce4a3c96f20324f9ba81ac8658f",
  ]) assert.ok(preflight.includes(markerHash), "missing private helper fingerprint " + markerHash);

  assert.match(preflight, /pg_catalog\.aclexplode/);
  assert.match(preflight, /a\.is_grantable/);
  assert.match(preflight, /p\.prosecdef/);
  assert.match(preflight, /pg_catalog\.pg_get_function_result/);
  assert.match(preflight, /v_acl IS DISTINCT FROM v_expected\.acl/);
  assert.match(preflight, /has_function_privilege\('anon'/);
  assert.match(preflight, /has_function_privilege\('authenticated'/);
  assert.match(preflight, /has_function_privilege\('service_role'/);
  assert.ok(start < draft.indexOf("CREATE OR REPLACE FUNCTION"), "fingerprints must run before any replacement");
});

test("collective token hash helper fingerprint and non-SECDEF search_path remain pinned", () => {
  const marker = "DO $stage7_collective_token_hash_preflight$";
  const start = draft.indexOf(marker);
  const end = draft.indexOf("$stage7_collective_token_hash_preflight$;", start);
  assert.ok(start >= 0 && end > start);
  const preflight = draft.slice(start, end);
  assert.ok(preflight.includes("2be53e800f6ecb6995cef723b88806d7"));
  assert.match(preflight, /v_security_definer IS DISTINCT FROM FALSE/);
  assert.match(preflight, /search_path=pg_catalog, extensions, private/);
  assert.match(preflight, /PUBLIC=EXECUTE\/postgres,postgres=EXECUTE\/postgres/);
});

test("rollback-only anon regression covers valid session, wrong/expired/revoked tokens and attempt IDOR", () => {
  const anonStart = regression.indexOf("DO $profile_anon$");
  const anonEnd = regression.indexOf("$profile_anon$;", anonStart);
  assert.ok(anonStart >= 0 && anonEnd > anonStart);
  const anonBlock = regression.slice(anonStart, anonEnd);
  for (const marker of [
    "STAGE7_ANON_LINEAR_EXAM_START_INVALID_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_CROSS_COMPETITION_START_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_VALID_START_FAILED",
    "STAGE7_ANON_LINEAR_EXAM_STATE_INVALID_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_EXPIRED_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_REVOKED_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_ATTEMPT_IDOR_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_DRAFT_INVALID_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_VALID_DRAFT_FAILED",
    "STAGE7_ANON_LINEAR_EXAM_ANSWER_INVALID_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_VALID_ANSWER_FAILED",
    "STAGE7_ANON_LINEAR_EXAM_SKIP_INVALID_TOKEN_ALLOWED",
    "STAGE7_ANON_LINEAR_EXAM_VALID_SKIP_FAILED",
  ]) assert.ok(anonBlock.includes(marker), "missing collective linear-exam security regression " + marker);

  for (const fixture of [
    "stage7-tranche21-valid-linear-exam-token-20261128-a",
    "stage7-tranche21-expired-linear-exam-token-20261128-b",
    "stage7-tranche21-revoked-linear-exam-token-20261128-c",
    "77777777-7777-4777-8777-777777777901",
  ]) assert.ok(regression.includes(fixture), "missing linear-exam fixture " + fixture);
  assert.ok(regression.includes("'stage7-tranche21-live-linear-exam-probe'"));
  assert.ok(regression.includes("'33333333-3333-4333-8333-333333333336'"));
  assert.ok(regression.includes("'66666666-6666-4666-8666-666666666683'"));
  assert.ok(regression.includes("'77777777-7777-4777-8777-777777777900'"));
  assert.ok(regression.includes("'77777777-7777-4777-8777-777777777902'"));
  assert.doesNotMatch(regression, /UPDATE public\\.competitions\\s+SET status = 'LIVE'/);
  assert.match(regression, /private\.hash_collective_token\(/);
  assert.match(regression.slice(anonEnd), /RESET ROLE;/);
  assert.match(regression, /ROLLBACK;/i);
});

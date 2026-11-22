import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const review = JSON.parse(read("docs/security/AUTH-STAGE-7-RLS-POLICY-REVIEW-2026-11-22.json"));
const sql = read("scripts/auth-migration/stage7-collective-portal-token-regression.sql");

const portalTables = review.tables.filter((t) => t.classification === "participant_portal_token_storage");
assert.equal(portalTables.length, 3, "portal credential, identity, and session tables must be reviewed separately");
const expected = [
  "public.answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)",
  "public.choose_collective_linear_exam_timeout(uuid,text,text)",
  "public.get_collective_linear_exam_state(uuid,text)",
  "public.get_collective_participant_certificate(text)",
  "public.get_collective_participant_result(text)",
  "public.list_collective_portal_competitions(text)",
  "public.open_collective_competition_session(text,uuid,text)",
  "public.resolve_collective_linear_exam_timeout(uuid,text)",
  "public.revoke_collective_access_session(text)",
  "public.revoke_collective_portal_session(text)",
  "public.save_collective_linear_exam_draft(uuid,text,uuid,jsonb)",
  "public.skip_collective_linear_exam_question(uuid,text)",
  "public.start_collective_linear_exam_attempt(uuid,text)",
  "public.verify_collective_portal_password(text)",
];
assert.equal(expected.length, 14);
for (const signature of expected) {
  const name = signature.slice("public.".length, signature.indexOf("("));
  assert.ok(sql.includes("public." + name + "("), "missing participant portal RPC test: " + signature);
}
assert.match(sql, /SET LOCAL ROLE anon/);
assert.match(sql, /request\.jwt\.claims/);
assert.match(sql, /STAGE7_PORTAL_INVALID_PASSWORD_ACCEPTED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_SESSION_OPENED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_TOKEN_RESULT_NOT_DENIED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_TOKEN_START_EXAM_NOT_DENIED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_TOKEN_ANSWER_NOT_DENIED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_TOKEN_SAVE_DRAFT_NOT_DENIED/);
assert.match(sql, /STAGE7_PORTAL_INVALID_TOKEN_SKIP_QUESTION_NOT_DENIED/);
assert.match(sql, /STAGE7_PORTAL_RPC_SCOPE_MISMATCH/);
assert.match(sql, /ROLLBACK;/);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:COMMIT|CREATE TABLE|DROP TABLE|GRANT|REVOKE)\b/i);
assert.match(sql, /COLLECTIVE_SESSION_INVALID/);
console.log("Stage 7 participant portal token contract passed: all 14 anon RPCs retain the token/password boundary and invalid sessions are rejected in a rollback-only fixture.");

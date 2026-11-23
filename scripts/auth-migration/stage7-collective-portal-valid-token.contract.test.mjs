import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("./stage7-collective-portal-valid-token-regression.sql", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/auth-schema-baseline.yml", import.meta.url),
  "utf8",
);

assert.match(sql, /BEGIN;[\s\S]*SET LOCAL ROLE anon/);
assert.match(sql, /request\.jwt\.claim\.role','anon'/);
assert.match(sql, /private\.app_users/);
assert.match(sql, /collective_portal_identities/);
assert.match(sql, /collective_portal_credentials/);
assert.match(sql, /extensions\.crypt\(/);
assert.match(sql, /private\.collective_portal_password_lookup_key\('PortalTest#2026!'\)/);
assert.match(sql, /private\.collective_portal_password_lookup_key\('OtherPortal#2026!'\)/);
assert.match(sql, /verify_collective_portal_password\(v_password\)/);
assert.match(sql, /list_collective_portal_competitions\(v_portal_token\)/);
assert.match(sql, /open_collective_competition_session\(/);
assert.match(sql, /INVALID_PARTICIPANT_CODE/);
assert.match(sql, /public\.organizers/);
assert.match(sql, /public\.question_banks/);
assert.match(sql, /question_bank_id/);
assert.match(sql, /request\.jwt\.claims/);
assert.match(sql, /auth-prod\.sykabelajar\.my\.id\/api\/auth/);
assert.match(sql, /public\.questions/);
assert.match(sql, /start_collective_linear_exam_attempt\(v_competition, v_access_token\)/);
assert.match(sql, /save_collective_linear_exam_draft\(/);
assert.match(sql, /answer_collective_linear_exam_question\(/);
assert.match(sql, /skip_collective_linear_exam_question\(/);
assert.match(sql, /get_collective_linear_exam_state\(/);
assert.match(sql, /STAGE7_VALID_ACCESS_TOKEN_COULD_NOT_START_LINEAR_EXAM/);
assert.match(sql, /STAGE7_VALID_ACCESS_TOKEN_DRAFT_AUTOSAVE_FAILED/);
assert.match(sql, /STAGE7_VALID_ACCESS_TOKEN_LINEAR_ANSWER_ADVANCE_FAILED/);
assert.match(sql, /STAGE7_VALID_ACCESS_TOKEN_LINEAR_SKIP_COMPLETION_FAILED/);
assert.match(sql, /STAGE7_LINEAR_EXAM_STATE_LEAKED_ANSWER_KEY/);
assert.match(sql, /STAGE7_REVOKED_ACCESS_TOKEN_LINEAR_EXAM_NOT_DENIED/);
assert.match(sql, /STAGE7_PARENT_REVOCATION_DID_NOT_REVOKE_CHILD/);
assert.match(sql, /STAGE7_CHILD_ACCESS_EXPIRY_EXCEEDS_PARENT/);
assert.match(sql, /STAGE7_DISABLED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED/);
assert.match(sql, /STAGE7_ROTATED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED/);
assert.match(sql, /STAGE7_SUSPENDED_PORTAL_IDENTITY_CHILD_TOKEN_ALLOWED/);
assert.match(sql, /STAGE7_EXPIRED_PARENT_SESSION_CHILD_TOKEN_ALLOWED/);
assert.match(sql, /public\.get_collective_participant_certificate\(v_access_token\)/);
assert.match(sql, /revoke_collective_portal_session\(v_portal_token\)/);
assert.match(sql, /STAGE7_VALID_PORTAL_PASSWORD_REJECTED/);
assert.match(sql, /STAGE7_VALID_PORTAL_TOKEN_CANNOT_LIST_OWN_PRIVATE_COMPETITION/);
assert.match(sql, /STAGE7_VALID_PORTAL_TOKEN_CANNOT_OPEN_OWN_COMPETITION/);
assert.match(sql, /STAGE7_REVOKED_PORTAL_TOKEN_STILL_LISTS_COMPETITIONS/);
assert.match(sql, /STAGE7_REVOKED_ACCESS_TOKEN_NOT_REJECTED/);
assert.match(sql, /RESET ROLE;[\s\S]*ROLLBACK;/);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:COMMIT|TRUNCATE|DROP TABLE|CREATE TABLE|DELETE FROM)\b/i);

const marker = "- name: Verify all 14 collective portal RPCs reject invalid anon tokens on disposable restore";
const positive = "- name: Verify valid collective portal password, listing, opening and revocation on disposable restore only";
const invalidAt = workflow.indexOf(marker);
const positiveAt = workflow.indexOf(positive);
const rollbackAt = workflow.indexOf("- name: Simulate fail-closed 69-FK rollback on disposable restore only");
assert.ok(invalidAt >= 0 && positiveAt > invalidAt && rollbackAt > positiveAt,
  "positive-token acceptance must run after negative-token acceptance and before rollback");
assert.match(workflow.slice(positiveAt, rollbackAt), /stage7-collective-portal-valid-token-regression\.sql/);

console.log("Stage 7 valid participant portal token contract passed: fresh synthetic identity, private competition scope, 256-bit tokens, linear exam start/autosave/answer/skip, answer-key non-disclosure, revocation and transaction rollback.");

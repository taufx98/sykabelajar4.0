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
assert.match(sql, /extensions\.digest\('PortalTe', 'sha256'\)/);
assert.match(sql, /verify_collective_portal_password\(v_password\)/);
assert.match(sql, /list_collective_portal_competitions\(v_portal_token\)/);
assert.match(sql, /open_collective_competition_session\(/);
assert.match(sql, /revoke_collective_access_session\(v_access_token\)/);
assert.match(sql, /revoke_collective_portal_session\(v_portal_token\)/);
assert.match(sql, /STAGE7_VALID_PORTAL_PASSWORD_REJECTED/);
assert.match(sql, /STAGE7_VALID_PORTAL_TOKEN_CANNOT_LIST_OWN_PRIVATE_COMPETITION/);
assert.match(sql, /STAGE7_VALID_PORTAL_TOKEN_CANNOT_OPEN_OWN_COMPETITION/);
assert.match(sql, /STAGE7_REVOKED_PORTAL_TOKEN_STILL_LISTS_COMPETITIONS/);
assert.match(sql, /STAGE7_REVOKED_ACCESS_TOKEN_NOT_REJECTED/);
assert.match(sql, /RESET ROLE;[\s\S]*ROLLBACK;/);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:COMMIT|TRUNCATE|DROP TABLE|CREATE TABLE|DELETE FROM)\b/i);

const marker = "- name: Verify all 14 collective portal RPCs reject invalid anon tokens on disposable restore only";
const positive = "- name: Verify valid collective portal password, listing, opening and revocation on disposable restore only";
const invalidAt = workflow.indexOf(marker);
const positiveAt = workflow.indexOf(positive);
const rollbackAt = workflow.indexOf("- name: Simulate fail-closed 69-FK rollback on disposable restore only");
assert.ok(invalidAt >= 0 && positiveAt > invalidAt && rollbackAt > positiveAt,
  "positive-token acceptance must run after negative-token acceptance and before rollback");
assert.match(workflow.slice(positiveAt, rollbackAt), /stage7-collective-portal-valid-token-regression\.sql/);

console.log("Stage 7 valid participant portal token contract passed: fresh synthetic identity, valid password/token, private competition listing, access opening, revocation and transaction rollback.");

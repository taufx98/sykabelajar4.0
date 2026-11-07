import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "stage3-production-schema-regression.sql"), "utf8");

assert.match(sql, /^BEGIN;\s*DO \$stage3_conflict_mode\$/m);
assert.match(sql,/current_setting\('plpgsql\.variable_conflict'\) IS DISTINCT FROM 'error'/);
assert.match(sql,/STAGE3_PLPGSQL_VARIABLE_CONFLICT_MODE_MUST_MATCH_PRODUCTION/);
assert.doesNotMatch(sql,/SET\s+LOCAL\s+plpgsql\.variable_conflict/i);
assert.match(sql,/CREATE_ORGANIZER/);
assert.match(sql,/v_competition_id\s*,\s*v_organizer_id\s*,\s*'stage3-auth-regression'/);
assert.match(sql,/EMAIL_VERIFICATION_REQUIRED/);
assert.match(sql,/PHONE_VERIFICATION_REQUIRED/);
assert.match(sql,/FREE_ORGANIZER_ALREADY_CLAIMED/);
assert.match(sql,/ROLLBACK;/);
assert.match(sql,/SET LOCAL ROLE authenticated/);
assert.match(sql,/SET LOCAL ROLE anon/);
assert.match(sql,/SET is_public=\(id = u_expired\)/i);
assert.match(sql,/STAGE3_RLS_ANON_PUBLIC_PROFILE_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_NON_ADMIN_AUDIT_LOG_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_ADMIN_AUDIT_LOG_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_USER_ROLES_OVERLAY_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_ORGANIZER_UPDATE_FAILED/);
assert.match(sql,/u_admin constant uuid/);

console.log("Stage 3 behavior regression contract passed: read-only PL/pgSQL production-mode guard, verified organizer gates, RLS role coverage, and rollback.");

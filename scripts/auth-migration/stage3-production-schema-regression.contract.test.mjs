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
const firstFixtureBoundary = sql.indexOf("$stage3_regression$;");
assert.notEqual(firstFixtureBoundary, -1, "first production-shaped fixture boundary exists");
const fixtureDeclarations = sql.slice(0, firstFixtureBoundary).matchAll(/^\\s*([uv]_[a-z0-9_]+)\\s+constant\\s+uuid\\s*:=/gmi);
const rlsSection = sql.slice(firstFixtureBoundary + "$stage3_regression$;".length);
for (const match of fixtureDeclarations) {
  assert.doesNotMatch(rlsSection, new RegExp("\\\\b" + match[1] + "\\\\b"),
    "first fixture-local variable must not leak into later independent DO blocks: " + match[1]);
}

assert.match(sql,/SET LOCAL ROLE authenticated/);
assert.match(sql,/SET LOCAL ROLE anon/);
assert.match(sql,/SET is_public=\(id = u_expired\)/i);
assert.match(sql,/STAGE3_RLS_ANON_PUBLIC_PROFILE_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_NON_ADMIN_AUDIT_LOG_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_ADMIN_AUDIT_LOG_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_USER_ROLES_OVERLAY_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_ORGANIZER_UPDATE_FAILED/);
assert.match(sql,/u_admin constant uuid/);
assert.match(sql,/STAGE3_RLS_TEACHER_ROSTER_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_UNRELATED_TEACHER_ROSTER_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_ATTEMPT_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_CANONICAL_PARTICIPANT_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ORDER_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_CROSS_USER_ORDER_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_PAYMENT_INTENT_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_PAYMENT_EVENT_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_ORDER_UPDATE_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_PAYMENT_INTENT_UPDATE_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_SHIPMENT_UPDATE_FAILED/);
assert.match(sql,/ROLLBACK;/);
assert.match(sql,/v_attempt_id constant uuid/);
assert.match(sql,/v_order_id constant uuid/);
assert.match(sql,/v_roster_id constant uuid/);
assert.match(sql,/u_active_member constant uuid/);
assert.match(sql,/u_inactive_member constant uuid/);
assert.match(sql,/v_collective_participant_id constant uuid/);
assert.match(sql,/STAGE3_RLS_TEACHER_COLLECTIVE_PARTICIPANT_CREATE_FAILED/);
assert.match(sql,/STAGE3_RLS_TEACHER_COLLECTIVE_PARTICIPANT_UPDATE_FAILED/);
assert.match(sql,/STAGE3_RLS_COLLECTIVE_CANONICAL_SYNC_STATE_FAILED/);
assert.match(sql,/STAGE3_RLS_STUDENT_COLLECTIVE_MANAGER_INSERT_ALLOWED/);
assert.match(sql,/STAGE3_RLS_STUDENT_COLLECTIVE_PARTICIPANT_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_UNRELATED_COLLECTIVE_MANAGER_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_ADMIN_COLLECTIVE_PARTICIPANT_READ_FAILED/);

assert.match(sql,/STAGE3_ORGANIZER_MEMBER_ROLE_SYNC_FAILED/);
assert.match(sql,/STAGE3_RLS_ORGANIZER_OWNER_UPDATE_FAILED/);
assert.match(sql,/STAGE3_RLS_ACTIVE_ORGANIZER_MEMBER_PLAN_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ACTIVE_VIEWER_ORGANIZER_UPDATE_ALLOWED/);
assert.match(sql,/STAGE3_RLS_ACTIVE_VIEWER_MEMBER_MANAGEMENT_ALLOWED/);
assert.match(sql,/STAGE3_RLS_INACTIVE_ORGANIZER_MEMBER_PLAN_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_INACTIVE_ORGANIZER_MEMBER_LIST_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_UNRELATED_ORGANIZER_PLAN_READ_ALLOWED/);
assert.match(sql,/STAGE3_RLS_AWARD_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_CERTIFICATE_OWNER_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_AWARD_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_CERTIFICATE_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_WISHLIST_OWNER_INSERT_READ_FAILED/);
assert.match(sql,/STAGE3_EXPECTED_WISHLIST_OWNER_GUARD/);
assert.match(sql,/STAGE3_RLS_ADMIN_WISHLIST_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_PLAN_ENTITLEMENT_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ADMIN_PLAN_ENTITLEMENT_UPDATE_FAILED/);
assert.match(sql,/STAGE3_RLS_ANON_POST_PUBLIC_DRAFT_VISIBILITY_FAILED/);
assert.match(sql,/STAGE3_RLS_ANON_COMMENT_MODERATION_VISIBILITY_FAILED/);
assert.match(sql,/STAGE3_RLS_ANON_FOLLOW_RELATIONSHIP_LEAK/);
assert.match(sql,/STAGE3_RLS_FOLLOWER_SIDE_RELATIONSHIP_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_FOLLOWED_SIDE_RELATIONSHIP_READ_FAILED/);
assert.match(sql,/STAGE3_RLS_ANON_PRODUCT_REVIEW_PUBLIC_READ_FAILED/);
assert.match(sql,/v_certificate_id constant uuid/);
assert.match(sql,/v_product_id constant uuid/);

console.log("Stage 3 behavior regression contract passed: read-only PL/pgSQL production-mode guard, verified organizer gates, RLS role coverage, and rollback.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(
  path.join(here, "../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql"),
  "utf8",
);
const regression = readFileSync(
  path.join(here, "./stage3-issuer-guard-regression.sql"),
  "utf8",
);
const issuer = "https://auth-prod.sykabelajar.my.id/api/auth";

assert.match(draft, /CREATE OR REPLACE FUNCTION private\.current_user_is_better_auth\(\)/);
assert.match(draft, /auth\.jwt\(\)\s*->>\s*'iss'/);
assert.ok(draft.includes(issuer), "all identity guards must pin the exact Production issuer");
assert.match(draft, /au\.identity_origin = 'better_auth'/);
assert.match(draft, /REVOKE ALL ON FUNCTION private\.current_user_is_better_auth\(\) FROM PUBLIC, anon/);
assert.match(draft, /GRANT EXECUTE ON FUNCTION private\.current_user_is_better_auth\(\) TO authenticated/);

for (const name of [
  "private.current_user_has_role",
  "private.current_user_is_active_organizer_member",
  "private.current_user_organizer_role",
  "private.collective_realtime_can_read",
  "private.collective_realtime_bind",
  "public.is_active_admin",
  "public.admin_adjust_user_currency",
  "public.admin_bulk_adjust_currency",
  "public.admin_set_certificate_status",
  "public.admin_set_collective_certificate_price",
  "public.admin_transition_certificate",
  "public.admin_transition_order",
  "public.auto_grade_essay_item",
  "public.create_collective_participants",
  "public.generate_awards_for_competition",
  "public.is_public_profile_admin",
  "public.issue_certificate_for_award",
  "public.list_teacher_achievement_report",
  "public.list_teacher_collective_certificates",
  "public.save_organizer_competition_config",
  "public.save_question_with_options",
]) {
  assert.match(
    draft,
    new RegExp("CREATE OR REPLACE FUNCTION " + name.replaceAll(".", "\\."), "i"),
    "missing guarded SECURITY DEFINER function: " + name,
  );
}

const adminFunctions = [
  "public.admin_adjust_user_currency",
  "public.admin_bulk_adjust_currency",
  "public.admin_set_certificate_status",
  "public.admin_set_collective_certificate_price",
  "public.admin_transition_certificate",
  "public.admin_transition_order",
];
for (const name of adminFunctions) {
  const escaped = name.replaceAll(".", "\\.");
  const definition = draft.match(new RegExp("CREATE OR REPLACE FUNCTION " + escaped + "[\\s\\S]*?\\$function\\$;", "i"))?.[0] ?? "";
  assert.ok(definition, "missing complete function body: " + name);
  assert.match(definition, /private\.current_user_is_admin\(\)/,
    "Admin RPC must use the issuer-gated shared helper: " + name);
  assert.doesNotMatch(definition, /FROM\s+(?:public\.)?user_roles\b/i,
    "Admin RPC must not independently authorize a legacy user_roles row: " + name);
}

for (const name of [
  "public.auto_grade_essay_item",
  "public.generate_awards_for_competition",
  "public.issue_certificate_for_award",
  "public.save_organizer_competition_config",
  "public.save_question_with_options",
]) {
  const escaped = name.replaceAll(".", "\\.");
  const definition = draft.match(new RegExp("CREATE OR REPLACE FUNCTION " + escaped + "[\\s\\S]*?\\$function\\$;", "i"))?.[0] ?? "";
  assert.ok(definition, "missing complete function body: " + name);
  assert.match(definition, /private\.current_user_is_active_organizer_member\(v_org\)/,
    "organizer operations must use the issuer-gated membership helper: " + name);
  assert.match(definition, /private\.current_user_is_admin\(\)/,
    "organizer operation Admin bypass must use issuer-gated helper: " + name);
}

const publicAdminProfile = draft.match(/CREATE OR REPLACE FUNCTION public\.is_public_profile_admin[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(publicAdminProfile, /JOIN private\.app_users as app_user/i);
assert.match(publicAdminProfile, /app_user\.identity_origin = 'better_auth'/);

const listTeacherCertificates = draft.match(/CREATE OR REPLACE FUNCTION public\.list_teacher_collective_certificates[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(listTeacherCertificates, /private\.current_user_is_better_auth\(\)/);
const realtimeBind = draft.match(/CREATE OR REPLACE FUNCTION private\.collective_realtime_bind[\s\S]*?\$function\$;/i)?.[0] ?? "";
assert.match(realtimeBind, /private\.current_user_is_better_auth\(\)/);


assert.match(regression, /has_schema_privilege\(current_user, 'private', 'USAGE'\)/);
assert.doesNotMatch(
  regression,
  /private\.current_user_(?:is_admin|organizer_role|is_active_organizer_member)\(/i,
  "authenticated must not call private helpers directly; verify them through public SECURITY DEFINER entrypoints",
);
assert.match(regression, /STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED/);
assert.match(regression, /STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED/);
assert.doesNotMatch(draft, /^(?:ALTER TABLE|DROP POLICY|INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM)\b/im,
  "draft must not mutate application data or replace RLS policy state");

console.log("Stage 3 SECURITY DEFINER issuer-guard contract passed: Admin and organizer RPCs use issuer-gated helpers and legacy app_users rows cannot satisfy the Admin checks.");

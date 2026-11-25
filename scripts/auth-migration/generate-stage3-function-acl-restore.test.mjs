import assert from "node:assert/strict";
import { renderFunctionAclRestore } from "./generate-stage3-function-acl-restore.mjs";

const names = [
  ["private","apply_referral_qualification","p_referred_user_id uuid, p_activity text, p_occurred_at timestamp with time zone"],
  ["private","capture_signup_referral",""],
  ["private","process_referral_email_confirmation",""],
  ["public","create_organizer","p_name text, p_slug text"],
  ["public","get_my_referrals",""],
  ["public","get_my_referrals_v2",""],
  ["public","get_my_verified_referrals",""],
  ["public","handle_new_auth_user",""],
  ["public","register_for_competition","p_competition_id uuid, p_participation_key text, p_competition_level_id uuid, p_social_proof_url text, p_twibbon_completed boolean, p_social_platform text, p_social_username text, p_referral_code text"],
  ["public","verify_pending_referrals",""],
  ["public","archive_my_order_history","p_order_id uuid"],
  ["public","bulk_import_roster_students","p_roster_id uuid, p_students jsonb"],
  ["public","cancel_my_pending_order","p_order_id uuid"],
  ["public","claim_and_complete_daily_task","p_task_id uuid"],
  ["public","claim_daily_checkin","p_date date, p_day_number integer"],
  ["public","claim_daily_task","p_task_id uuid"],
  ["public","claim_organizer_voucher","p_voucher_id uuid"],
  ["public","claim_rpc_recovery","p_rpc_name text"],
  ["public","complete_daily_task","p_task_id uuid"],
  ["public","create_ad_banner_payment_order","p_request_id uuid, p_payment_method_id uuid, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_unique_code integer"],
  ["public","provision_collective_registration","p_registration_id uuid"],
  ["public","regenerate_collective_participant_password","p_participant_id uuid"],
  ["private","provision_collective_registration","p_registration_id uuid"],
  ["public","get_canonical_competition_result","p_participant_id uuid"],
  ["public","get_all_currency_logs","p_limit integer"],
  ["public","get_user_currency_logs","p_target_user_id uuid, p_limit integer"],
  ["public","get_active_organizer_entitlements","p_organizer_id uuid"],
  ["public","get_organizer_effective_plan","p_organizer_id uuid"],
  ["public","get_organizer_competition_quota","p_organizer_id uuid"],
  ["public","admin_adjust_user_currency","p_target_user_id uuid, p_currency_type text, p_delta bigint, p_reason text"],
  ["public","admin_assign_organizer_plan","p_organizer_id uuid, p_plan_code text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone"],
  ["public","admin_bulk_adjust_currency","p_user_ids uuid[], p_currency_type text, p_delta bigint, p_reason text"],
  ["public","admin_change_username","p_user_id uuid, p_username text, p_reason text"],
  ["public","admin_create_organizer","p_owner_user_id uuid, p_name text, p_slug text"],
  ["public","get_linear_exam_activity","p_competition_id uuid, p_limit integer, p_offset integer"],
  ["public","grade_competition_attempt","p_attempt_id uuid"],
  ["public","grade_essay_similarity","p_attempt_id uuid, p_question_id uuid"],
  ["public","save_manual_grading_item","p_grading_item_id uuid, p_score numeric, p_feedback text"],
  ["public","start_organizer_exam_preview","p_competition_id uuid"],
  ["public","create_follow_request","p_target_user_id uuid"],
  ["public","get_my_canonical_competition_result","p_competition_id uuid"],
  ["public","get_my_canonical_participant","p_competition_id uuid"],
  ["public","get_my_learning_insights",""],
  ["public","get_my_referral_tier_awards",""],
  ["public","list_my_canonical_certificates",""],
  ["public","list_my_claimed_collective_history",""],
  ["public","list_my_competition_dashboard",""],
  ["public","list_my_participant_core",""],
  ["public","list_my_shop_vouchers",""],
  ["public","mark_my_shop_vouchers_seen",""],
  ["public","remove_follow","p_following_id uuid"],
  ["public","respond_follow_request","p_follow_request_id uuid, p_approved boolean"],
  ["public","save_my_commerce_product_review","p_product_id uuid, p_rating smallint, p_review text"],
  ["public","choose_organizer_plan","p_organizer_id uuid, p_plan_code text"],
  ["public","get_organizer_competition_result_overview","p_competition_id uuid, p_limit integer, p_offset integer"],
  ["public","list_organizer_registrations","p_organizer_id uuid"],
  ["public","request_custom_organizer_plan","p_organizer_id uuid, p_requested_features jsonb, p_notes text, p_contact_whatsapp text"],
  ["public","review_registration","p_registration_id uuid, p_decision text, p_reason text"],
];

const functionRows = names.map(([schema_name,function_name,identity_arguments],index)=>({
    schema_name,function_name,identity_arguments,
    function_acl_entries: [
      {grantee:"postgres",privilege_type:"EXECUTE",is_grantable:true,grantor:"postgres"},
      ...(index===3 || index===8 ? [{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index===6 ? [{grantee:"PUBLIC",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"anon",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index===7 || index===9 ? [{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index===22 ? [{grantee:"PUBLIC",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index>=10 && index!==22 ? [{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
    ],
  }));
const metadata = {
  auth_dependent_functions: functionRows.slice(0,10),
  user_scoped_issuer_functions: functionRows.slice(10,44),
  personal_rpc_issuer_functions: functionRows.slice(44),
};
assert.equal(metadata.auth_dependent_functions.length, 10);
assert.equal(metadata.user_scoped_issuer_functions.length, 34);
assert.equal(metadata.personal_rpc_issuer_functions.length, 14);

const sql = renderFunctionAclRestore(metadata);
assert.match(sql,/REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_organizer"|REVOKE ALL PRIVILEGES ON FUNCTION public\.create_organizer/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_organizer\(text,text\) TO "authenticated"/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.register_for_competition/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.handle_new_auth_user\(\) TO "service_role"/);
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.get_my_verified_referrals() TO PUBLIC;'));
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.get_my_verified_referrals() TO "anon";'));
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.create_organizer(text,text) TO "anon";'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION private.apply_referral_qualification(uuid,text,timestamptz) TO "anon";'), false);
assert.match(sql,/REVOKE ALL PRIVILEGES ON FUNCTION public\.archive_my_order_history\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(sql,/REVOKE ALL PRIVILEGES ON FUNCTION public\.create_follow_request\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_follow_request\(uuid\) TO "authenticated";/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_follow_request\(uuid\) TO "service_role";/);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.create_follow_request(uuid) TO "anon";'), false);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.archive_my_order_history\(uuid\) TO "authenticated";/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.archive_my_order_history\(uuid\) TO "service_role";/);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.archive_my_order_history(uuid) TO PUBLIC;'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.archive_my_order_history(uuid) TO "anon";'), false);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_ad_banner_payment_order\(uuid,uuid,text,text,integer,integer,text,text,integer\) TO "authenticated";/);
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.provision_collective_registration(uuid) TO "authenticated";'));
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.provision_collective_registration(uuid) TO "service_role";'));
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.provision_collective_registration(uuid) TO "anon";'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.provision_collective_registration(uuid) TO PUBLIC;'), false);
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.regenerate_collective_participant_password(uuid) TO "authenticated";'));
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.regenerate_collective_participant_password(uuid) TO "service_role";'));
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.regenerate_collective_participant_password(uuid) TO "anon";'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.regenerate_collective_participant_password(uuid) TO PUBLIC;'), false);

for (const signature of [
  "public.choose_organizer_plan(uuid,text)",
  "public.get_organizer_competition_result_overview(uuid,integer,integer)",
  "public.list_organizer_registrations(uuid)",
  "public.request_custom_organizer_plan(uuid,jsonb,text,text)",
  "public.review_registration(uuid,text,text)",
]) {
  assert.ok(sql.includes("REVOKE ALL PRIVILEGES ON FUNCTION " + signature +
    " FROM PUBLIC, anon, authenticated, service_role;"),
    "Tranche 16 ACL must be reset to the exact captured Production grant set: " + signature);
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION " + signature + " TO \"authenticated\";"),
    "Tranche 16 authenticated EXECUTE must be restored from Production: " + signature);
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION " + signature + " TO \"service_role\";"),
    "Tranche 16 service_role EXECUTE must be restored from Production: " + signature);
  assert.equal(sql.includes("GRANT EXECUTE ON FUNCTION " + signature + " TO \"anon\";"), false,
    "Tranche 16 must not gain anon EXECUTE: " + signature);
  assert.equal(sql.includes("GRANT EXECUTE ON FUNCTION " + signature + " TO PUBLIC;"), false,
    "Tranche 16 must not gain PUBLIC EXECUTE: " + signature);
}
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION private.provision_collective_registration(uuid) TO PUBLIC;'));
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION private.provision_collective_registration(uuid) TO "anon";'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION private.provision_collective_registration(uuid) TO "authenticated";'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION private.provision_collective_registration(uuid) TO "service_role";'), false);
assert.match(sql,/FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql,/local disposable restore only/);
assert.throws(()=>renderFunctionAclRestore({...metadata,user_scoped_issuer_functions:metadata.user_scoped_issuer_functions.slice(1)}),/all 58/);
assert.throws(()=>renderFunctionAclRestore({...metadata, personal_rpc_issuer_functions:metadata.personal_rpc_issuer_functions.slice(1)}),/all 58/);

assert.throws(()=>renderFunctionAclRestore({
  ...metadata,
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"attacker",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}]
  }:row)
}),/Unsupported function ACL grantee/);
assert.throws(()=>renderFunctionAclRestore({
  ...metadata,
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"postgres",privilege_type:"UPDATE",is_grantable:false,grantor:"postgres"}]
  }:row)
}),/Unsupported function ACL privilege/);
assert.throws(()=>renderFunctionAclRestore({
  ...metadata,
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"postgres",privilege_type:"EXECUTE",is_grantable:false,grantor:"not-postgres"}]
  }:row)
}),/Unexpected function ACL grantor/);

console.log("Stage 3 function ACL restore generator tests passed: exact role allowlist, fail-closed grants, local-only SQL.");

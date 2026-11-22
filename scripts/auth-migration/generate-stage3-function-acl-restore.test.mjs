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
];

const functionRows = names.map(([schema_name,function_name,identity_arguments],index)=>({
    schema_name,function_name,identity_arguments,
    function_acl_entries: [
      {grantee:"postgres",privilege_type:"EXECUTE",is_grantable:true,grantor:"postgres"},
      ...(index===3 || index===8 ? [{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index===6 ? [{grantee:"PUBLIC",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"anon",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index===7 || index===9 ? [{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
      ...(index>=10 ? [{grantee:"authenticated",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"},{grantee:"service_role",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}] : []),
    ],
  }));
const metadata = {
  auth_dependent_functions: functionRows.slice(0,10),
  user_scoped_issuer_functions: functionRows.slice(10),
};

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
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.archive_my_order_history\(uuid\) TO "authenticated";/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.archive_my_order_history\(uuid\) TO "service_role";/);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.archive_my_order_history(uuid) TO PUBLIC;'), false);
assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.archive_my_order_history(uuid) TO "anon";'), false);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_ad_banner_payment_order\(uuid,uuid,text,text,integer,integer,text,text,integer\) TO "authenticated";/);
assert.match(sql,/FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql,/local disposable restore only/);
assert.throws(()=>renderFunctionAclRestore({...metadata,user_scoped_issuer_functions:metadata.user_scoped_issuer_functions.slice(1)}),/all 20/);
assert.throws(()=>renderFunctionAclRestore({
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"attacker",privilege_type:"EXECUTE",is_grantable:false,grantor:"postgres"}]
  }:row)
}),/Unsupported function ACL grantee/);
assert.throws(()=>renderFunctionAclRestore({
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"postgres",privilege_type:"UPDATE",is_grantable:false,grantor:"postgres"}]
  }:row)
}),/Unsupported function ACL privilege/);
assert.throws(()=>renderFunctionAclRestore({
  auth_dependent_functions:metadata.auth_dependent_functions.map((row,index)=>index===0?{
    ...row,function_acl_entries:[{grantee:"postgres",privilege_type:"EXECUTE",is_grantable:false,grantor:"not-postgres"}]
  }:row)
}),/Unexpected function ACL grantor/);

console.log("Stage 3 function ACL restore generator tests passed: exact role allowlist, fail-closed grants, local-only SQL.");

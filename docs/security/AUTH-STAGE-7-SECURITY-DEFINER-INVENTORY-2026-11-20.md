# Production DB2 exposed SECURITY DEFINER inventory (review queue)

Captured read-only from project `mvdczyitbkxkldjughor`, PostgreSQL 17.6, 20 November 2026.

This is the exact catalog list of the **118 public SECURITY DEFINER function signatures** executable by `authenticated` that did not match the coarse source-text indicators `private.current_user_is_admin`, `private.current_user_has_role`, `private.current_user_is_better_auth`, or `auth.jwt()`.

These are NOT proven vulnerabilities. Flags are simple source-text indicators and do not inspect called functions, token validation quality, dynamic SQL, effective ownership/ACL dependencies, or complete authorization semantics. Every row must be manually classified before Production Stage 3 DDL. The 39 rows with anon EXECUTE are a subset of these 118; the full advisor reports 46 anon-executable SECURITY DEFINER functions. This list excludes 84 additional authenticated-executable functions that mention `private.current_user_is_admin()`; the Stage 3 draft rewrites the shared Admin-role helper, but these also require regression coverage.

Summary of this review queue:
- 118 signatures across 117 unique names (one overloaded function).
- 77 use `auth.uid()`.
- 19 read `user_roles` directly.
- 10 accept `p_access_token`; 3 accept `p_portal_token`.
- 41 contain no `auth.uid()` marker; this does not imply they are safe or public.

| Classification | Required action |
|---|---|
| Better Auth user RPC | Add/use the shared issuer + `private.app_users.identity_origin='better_auth'` guard and test legacy issuer denial |
| Admin/organizer RPC | Use issuer-gated role/membership helper; never rely on direct legacy `user_roles` checks |
| Public read RPC | Explicitly allowlist intended public fields/rows; verify no private data |
| Participant/portal token RPC | Test entropy, ownership/scope, expiry, replay, and wrong-participant denial |
| Worker/scheduler/internal RPC | Restrict EXECUTE to the actual server/scheduler role |
| Deprecated/unreferenced RPC | Remove browser EXECUTE only after proving no callers |

No Production ACL, function, trigger, policy, table, or user data was changed to generate this inventory.

## Full signature inventory

| SECURITY DEFINER function | anon EXECUTE | uses auth.uid | reads user_roles | token parameter | reads profiles |
|---|:---:|:---:|:---:|---|:---:|
| `public.admin_adjust_user_currency(p_target_user_id uuid, p_currency_type text, p_delta bigint, p_reason text)` | no | yes | yes | none | yes |
| `public.admin_bulk_adjust_currency(p_user_ids uuid[], p_currency_type text, p_delta bigint, p_reason text)` | no | yes | yes | none | yes |
| `public.admin_evaluate_badges()` | yes | yes | no | none | yes |
| `public.admin_set_certificate_status(p_certificate_verification_id uuid, p_to_status certificate_status, p_reason text)` | no | yes | yes | none | no |
| `public.admin_set_collective_certificate_price(p_amount numeric)` | no | yes | yes | none | no |
| `public.admin_transition_certificate(p_certificate_id uuid, p_to_status certificate_status, p_reason text)` | no | yes | yes | none | no |
| `public.admin_transition_order(p_order_id uuid, p_to_status order_status, p_reason text, p_tracking_number text, p_provider text)` | no | yes | yes | none | no |
| `public.answer_collective_linear_exam_question(p_attempt_id uuid, p_access_token text, p_question_id uuid, p_answer_json jsonb, p_skip boolean)` | yes | no | no | p_access_token | no |
| `public.answer_linear_exam_question(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb, p_skip boolean)` | no | no | no | none | no |
| `public.archive_my_order_history(p_order_id uuid)` | no | yes | no | none | no |
| `public.auto_grade_essay_item(p_attempt_id uuid, p_question_id uuid)` | no | yes | yes | none | no |
| `public.bulk_import_roster_students(p_roster_id uuid, p_students jsonb)` | no | yes | no | none | no |
| `public.cancel_my_pending_order(p_order_id uuid)` | no | yes | no | none | no |
| `public.choose_collective_linear_exam_timeout(p_attempt_id uuid, p_access_token text, p_decision text)` | yes | no | no | p_access_token | no |
| `public.choose_linear_exam_timeout(p_attempt_id uuid, p_decision text)` | no | no | no | none | no |
| `public.claim_and_complete_daily_task(p_task_id uuid)` | no | yes | no | none | no |
| `public.claim_collective_participant(p_participant_code text, p_password text)` | no | yes | no | none | no |
| `public.claim_daily_checkin(p_date date, p_day_number integer)` | no | yes | no | none | no |
| `public.claim_daily_task(p_task_id uuid)` | no | yes | no | none | no |
| `public.claim_organizer_voucher(p_voucher_id uuid)` | no | yes | no | none | no |
| `public.claim_rpc_recovery(p_rpc_name text)` | no | yes | no | none | no |
| `public.complete_daily_task(p_task_id uuid)` | no | yes | no | none | no |
| `public.create_ad_banner_payment_order(p_request_id uuid, p_payment_method_id uuid, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_unique_code integer)` | no | yes | no | none | no |
| `public.create_collective_certificate_order(p_certificate_id uuid)` | no | yes | yes | none | no |
| `public.create_collective_registration_order(p_competition_id uuid, p_roster_student_ids uuid[], p_competition_level_id uuid, p_certificate_policy text, p_school_id uuid, p_school_name text, p_contact_name text, p_contact_whatsapp text, p_payment_method_id uuid, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_idempotency_key uuid)` | no | yes | no | none | no |
| `public.create_follow_request(p_target_user_id uuid)` | no | yes | no | none | yes |
| `public.create_organizer(p_name text, p_slug text)` | no | yes | yes | none | no |
| `public.create_shop_collective_certificate_order_with_vouchers(p_certificate_id uuid, p_shop_product_id uuid, p_payment_method text, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_whatsapp text, p_voucher_ids uuid[])` | no | yes | no | none | no |
| `public.create_shop_product_order_with_edu_coin_vouchers(p_product_id uuid, p_quantity integer, p_whatsapp text, p_target_organizer_id uuid, p_voucher_ids uuid[])` | no | yes | no | none | yes |
| `public.create_shop_product_order_with_vouchers(p_product_id uuid, p_quantity integer, p_whatsapp text, p_payment_method text, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_target_organizer_id uuid, p_voucher_ids uuid[])` | no | yes | no | none | no |
| `public.ensure_referral_code()` | no | yes | no | none | no |
| `public.generate_awards_for_competition(p_competition_id uuid)` | no | yes | yes | none | no |
| `public.get_certificate_verification(p_verification_code text)` | yes | no | no | none | no |
| `public.get_collective_certificate_price()` | no | no | no | none | no |
| `public.get_collective_linear_exam_state(p_attempt_id uuid, p_access_token text)` | yes | no | no | p_access_token | no |
| `public.get_collective_participant_certificate(p_access_token text)` | yes | no | no | p_access_token | no |
| `public.get_collective_participant_result(p_access_token text)` | yes | no | no | p_access_token | no |
| `public.get_collective_registration(p_registration_id uuid)` | no | yes | no | none | no |
| `public.get_collective_registration_options(p_competition_id uuid)` | no | no | no | none | no |
| `public.get_daily_checkin_streak_rewards(p_date date)` | no | yes | no | none | no |
| `public.get_follow_status(p_follower_id uuid, p_following_id uuid)` | yes | yes | no | none | no |
| `public.get_home_snapshot(p_feed_limit integer)` | yes | no | no | none | no |
| `public.get_linear_exam_state(p_attempt_id uuid)` | no | no | no | none | no |
| `public.get_my_canonical_competition_result(p_competition_id uuid)` | no | yes | no | none | no |
| `public.get_my_canonical_participant(p_competition_id uuid)` | no | yes | no | none | no |
| `public.get_my_learning_insights()` | no | yes | no | none | no |
| `public.get_my_referral_tier_awards()` | no | yes | no | none | no |
| `public.get_my_referrals()` | no | yes | no | none | yes |
| `public.get_my_referrals_v2()` | no | yes | no | none | yes |
| `public.get_my_verified_referrals()` | yes | yes | no | none | yes |
| `public.get_organizer_exam_preview_report(p_attempt_id uuid)` | no | yes | no | none | no |
| `public.get_organizer_payment_config()` | no | yes | no | none | no |
| `public.get_platform_stats()` | yes | no | no | none | yes |
| `public.get_profile_connections(p_profile_id uuid, p_mode text)` | yes | yes | no | none | yes |
| `public.get_public_coin_leaderboard(p_limit integer)` | yes | no | yes | none | yes |
| `public.get_public_collective_certificate(p_verification_code text)` | yes | no | no | none | no |
| `public.get_public_competition_detail_summary(p_competition_id uuid)` | yes | no | no | none | yes |
| `public.get_public_competition_participants(p_slug text, p_limit integer, p_offset integer)` | yes | no | no | none | no |
| `public.get_public_competition_question_count(p_competition_id uuid)` | yes | no | no | none | no |
| `public.get_public_competition_results(p_slug text, p_limit integer, p_offset integer)` | yes | no | no | none | no |
| `public.get_public_competitions(p_limit integer)` | yes | no | no | none | yes |
| `public.get_public_feed(p_limit integer, p_before timestamp with time zone)` | yes | yes | no | none | yes |
| `public.get_public_leaderboard(p_limit integer)` | yes | no | yes | none | yes |
| `public.get_public_leaderboard_enriched(p_period text, p_limit integer)` | yes | no | yes | none | yes |
| `public.get_public_profile_social(p_profile_id uuid)` | yes | yes | no | none | no |
| `public.get_public_school_leaderboard(p_period text, p_limit integer)` | yes | no | yes | none | yes |
| `public.get_referral_program_settings()` | no | yes | no | none | no |
| `public.get_referral_program_settings_v2()` | no | yes | no | none | no |
| `public.is_public_profile_admin(p_profile_id uuid)` | yes | yes | yes | none | yes |
| `public.issue_certificate_for_award(p_award_id uuid)` | no | yes | yes | none | yes |
| `public.join_organizer(p_slug text, p_access_code text)` | no | yes | no | none | no |
| `public.list_active_shop_promo_banners()` | yes | no | no | none | no |
| `public.list_claimable_organizer_vouchers()` | no | yes | no | none | no |
| `public.list_collective_portal_competitions(p_portal_token text)` | yes | no | no | p_portal_token | no |
| `public.list_my_canonical_certificates()` | no | yes | no | none | no |
| `public.list_my_claimed_collective_history()` | no | yes | no | none | no |
| `public.list_my_competition_dashboard()` | no | yes | no | none | no |
| `public.list_my_participant_core()` | no | yes | no | none | no |
| `public.list_my_shop_vouchers()` | no | yes | no | none | no |
| `public.list_public_commerce_product_sales_counts()` | yes | no | no | none | no |
| `public.list_shop_checkout_vouchers(p_product_id uuid, p_quantity integer, p_subtotal numeric, p_shipping_cost numeric)` | no | yes | no | none | no |
| `public.list_teacher_collective_certificates(p_competition_id uuid)` | no | yes | yes | none | no |
| `public.list_teacher_collective_participants(p_competition_id uuid)` | no | yes | no | none | no |
| `public.mark_my_shop_vouchers_seen()` | no | yes | no | none | no |
| `public.mark_rpc_healthy(p_rpc_name text)` | no | yes | no | none | no |
| `public.open_collective_competition_session(p_portal_token text, p_competition_id uuid, p_participant_code text)` | yes | no | no | p_portal_token | no |
| `public.provision_collective_registration(p_registration_id uuid)` | no | yes | no | none | no |
| `public.record_shop_promo_banner_event(p_banner_id uuid, p_event_type text, p_visitor_key text)` | yes | no | no | none | no |
| `public.regenerate_collective_participant_password(p_participant_id uuid)` | no | yes | no | none | no |
| `public.register_for_competition(p_competition_id uuid, p_participation_key text, p_competition_level_id uuid, p_social_proof_url text, p_twibbon_completed boolean, p_social_platform text, p_social_username text, p_referral_code text)` | no | yes | no | none | no |
| `public.register_for_competition_with_integrity(p_competition_id uuid, p_participation_key text, p_competition_level_id uuid, p_social_proof_url text, p_twibbon_completed boolean, p_social_platform text, p_social_username text, p_referral_code text, p_integrity_agreed boolean)` | no | yes | no | none | no |
| `public.register_for_competition_with_integrity_and_coin_bypass(p_competition_id uuid, p_participation_key text, p_competition_level_id uuid, p_social_proof_url text, p_social_platform text, p_social_username text, p_referral_code text, p_integrity_agreed boolean, p_edu_coin_bypass boolean)` | no | yes | no | none | yes |
| `public.remove_follow(p_target_user_id uuid)` | no | yes | no | none | no |
| `public.report_competition_comment(p_comment_id uuid, p_reason text)` | no | yes | no | none | no |
| `public.report_rpc_failure(p_rpc_name text, p_error_code text, p_error_message text)` | no | yes | no | none | no |
| `public.report_system_error(p_source text, p_error_code text, p_error_message text, p_severity text, p_context jsonb, p_path text, p_fingerprint text)` | no | yes | no | none | no |
| `public.resolve_collective_linear_exam_timeout(p_attempt_id uuid, p_access_token text)` | yes | no | no | p_access_token | no |
| `public.resolve_daily_checkin_reward(p_date date, p_day_number integer)` | no | no | no | none | no |
| `public.resolve_linear_exam_timeout(p_attempt_id uuid)` | no | no | no | none | no |
| `public.respond_follow_request(p_follower_id uuid, p_accept boolean)` | no | yes | no | none | yes |
| `public.revoke_collective_access_session(p_access_token text)` | yes | no | no | p_access_token | no |
| `public.revoke_collective_portal_session(p_portal_token text)` | yes | no | no | p_portal_token | no |
| `public.save_collective_linear_exam_draft(p_attempt_id uuid, p_access_token text, p_question_id uuid, p_answer_json jsonb)` | yes | no | no | p_access_token | no |
| `public.save_linear_exam_draft(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb)` | no | no | no | none | no |
| `public.save_my_commerce_product_review(p_product_id uuid, p_rating smallint, p_review text)` | no | yes | no | none | no |
| `public.save_organizer_competition_config(p_competition_id uuid, p_level jsonb, p_registration_rule jsonb, p_rewards jsonb)` | no | yes | yes | none | no |
| `public.save_question_with_options(p_question_id uuid, p_question_bank_id uuid, p_type text, p_prompt text, p_points numeric, p_required boolean, p_display_order integer, p_status text, p_config jsonb, p_options jsonb)` | no | yes | yes | none | no |
| `public.set_collective_participant_password(p_participant_id uuid, p_password text)` | no | yes | no | none | no |
| `public.skip_collective_linear_exam_question(p_attempt_id uuid, p_access_token text)` | yes | no | no | p_access_token | no |
| `public.skip_linear_exam_question(p_attempt_id uuid)` | no | no | no | none | no |
| `public.start_collective_linear_exam_attempt(p_competition_id uuid, p_access_token text)` | yes | no | no | p_access_token | no |
| `public.start_linear_exam_attempt(p_competition_id uuid)` | no | yes | no | none | no |
| `public.sync_collective_registration_order_payment(p_order_id uuid)` | no | yes | no | none | no |
| `public.sync_competition_registration_status(p_competition_id uuid)` | yes | no | no | none | no |
| `public.validate_organizer_voucher(p_code text)` | no | yes | no | none | no |
| `public.validate_organizer_voucher(p_code text, p_plan_code text, p_billing_period text)` | no | yes | no | none | no |
| `public.verify_collective_participant_access(p_participant_code text, p_password text)` | yes | no | no | none | no |
| `public.verify_collective_portal_password(p_password text)` | yes | no | no | none | no |

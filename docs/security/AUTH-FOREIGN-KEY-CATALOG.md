# Supabase auth.users foreign-key catalog snapshot

Snapshot date: 4 November 2026  
Source: read-only PostgreSQL catalog query against the current production project `mvdczyitbkxkldjughor`. Only schema metadata was returned; no application rows, UUID values, emails, credentials, or tokens were exported.

## Scope and verified metadata

This snapshot contains **69 validated foreign keys** from application schemas to `auth.users(id)`:

| Schema | Count |
|---|---:|
| `private` | 4 |
| `public` | 65 |
| **Total** | **69** |

All 69 constraints have the same shape:
- Referenced relation/column: `auth.users(id)`
- Column mapping: single-column UUID FK
- `MATCH SIMPLE`
- `ON UPDATE NO ACTION`
- `NOT DEFERRABLE`, initially immediate
- `VALIDATED`

Only `ON DELETE` differs. The observed distribution is:
- `CASCADE`: 42
- `SET NULL`: 18
- `NO ACTION`: 8
- `RESTRICT`: 1

## Exact constraint mapping

This mapping is the reference when constructing a replacement constraint to `private.app_users(id)`. Preserve the source table/column, exact existing constraint name, and exact `ON DELETE` action. Do not generate one blanket action for all tables.

| Table / column | Existing constraint name | Existing ON DELETE |
|---|---|---|
| `private.collective_chat_realtime_sessions.auth_user_id` | `collective_chat_realtime_sessions_auth_user_id_fkey` | `CASCADE` |
| `private.organizer_access_codes.rotated_by` | `organizer_access_codes_rotated_by_fkey` | `NO ACTION` |
| `private.referral_program_settings.updated_by` | `referral_program_settings_updated_by_fkey` | `SET NULL` |
| `private.referral_tier_awards.referrer_user_id` | `referral_tier_awards_referrer_user_id_fkey` | `CASCADE` |
| `public.ad_banner_requests.user_id` | `ad_banner_requests_user_id_fkey` | `CASCADE` |
| `public.ad_banners.user_id` | `ad_banners_user_id_fkey` | `SET NULL` |
| `public.addresses.user_id` | `addresses_user_id_fkey` | `CASCADE` |
| `public.attempts.participant_id` | `attempts_participant_id_fkey` | `CASCADE` |
| `public.attempts.preview_owner_id` | `attempts_preview_owner_id_fkey` | `CASCADE` |
| `public.audit_logs.actor_user_id` | `audit_logs_actor_user_id_fkey` | `SET NULL` |
| `public.awards.user_id` | `awards_user_id_fkey` | `CASCADE` |
| `public.badge_audit_logs.actor_user_id` | `badge_audit_logs_actor_user_id_fkey` | `SET NULL` |
| `public.badges.created_by` | `badges_created_by_fkey` | `NO ACTION` |
| `public.certificates.user_id` | `certificates_user_id_fkey` | `CASCADE` |
| `public.chat_blocks.blocked_id` | `chat_blocks_blocked_id_fkey` | `CASCADE` |
| `public.chat_blocks.blocker_id` | `chat_blocks_blocker_id_fkey` | `CASCADE` |
| `public.chat_group_invites.created_by` | `chat_group_invites_created_by_fkey` | `CASCADE` |
| `public.chat_group_members.user_id` | `chat_group_members_user_id_fkey` | `CASCADE` |
| `public.chat_group_messages.sender_user_id` | `chat_group_messages_sender_user_id_fkey` | `SET NULL` |
| `public.chat_group_reads.user_id` | `chat_group_reads_user_id_fkey` | `CASCADE` |
| `public.chat_groups.owner_user_id` | `chat_groups_owner_user_id_fkey` | `CASCADE` |
| `public.chat_messages.sender_id` | `chat_messages_sender_id_fkey` | `CASCADE` |
| `public.chat_spam_controls.user_id` | `chat_spam_controls_user_id_fkey` | `CASCADE` |
| `public.chat_thread_hidden.user_id` | `chat_thread_hidden_user_id_fkey` | `CASCADE` |
| `public.chat_thread_reads.user_id` | `chat_thread_reads_user_id_fkey` | `CASCADE` |
| `public.chat_threads.handled_by` | `chat_threads_handled_by_fkey` | `NO ACTION` |
| `public.chat_threads.participant_id` | `chat_threads_participant_id_fkey` | `CASCADE` |
| `public.chat_threads.user_id` | `chat_threads_user_id_fkey` | `CASCADE` |
| `public.collective_certificate_orders.payer_user_id` | `collective_certificate_orders_payer_user_id_fkey` | `NO ACTION` |
| `public.collective_registrations.teacher_user_id` | `collective_registrations_teacher_user_id_fkey` | `RESTRICT` |
| `public.comment_likes.user_id` | `comment_likes_user_id_fkey` | `CASCADE` |
| `public.comment_reports.reporter_user_id` | `comment_reports_reporter_user_id_fkey` | `SET NULL` |
| `public.comments.user_id` | `comments_user_id_fkey` | `CASCADE` |
| `public.competition_status_history.changed_by` | `competition_status_history_changed_by_fkey` | `SET NULL` |
| `public.currency_adjustment_logs.admin_id` | `currency_adjustment_logs_admin_id_fkey` | `NO ACTION` |
| `public.daily_checkin_settings.updated_by` | `daily_checkin_settings_updated_by_fkey` | `NO ACTION` |
| `public.daily_checkins.user_id` | `daily_checkins_user_id_fkey` | `CASCADE` |
| `public.daily_task_claims.user_id` | `daily_task_claims_user_id_fkey` | `CASCADE` |
| `public.edu_coin_ledger.user_id` | `edu_coin_ledger_user_id_fkey` | `CASCADE` |
| `public.grading_items.grader_id` | `grading_items_grader_id_fkey` | `SET NULL` |
| `public.home_slides.created_by` | `home_slides_created_by_fkey` | `SET NULL` |
| `public.notification_preferences.user_id` | `notification_preferences_user_id_fkey` | `CASCADE` |
| `public.notifications.user_id` | `notifications_user_id_fkey` | `CASCADE` |
| `public.orders.user_id` | `orders_user_id_fkey` | `CASCADE` |
| `public.organizer_custom_plan_requests.requester_user_id` | `organizer_custom_plan_requests_requester_user_id_fkey` | `CASCADE` |
| `public.organizer_custom_plan_requests.reviewed_by` | `organizer_custom_plan_requests_reviewed_by_fkey` | `SET NULL` |
| `public.organizer_members.user_id` | `organizer_members_user_id_fkey` | `CASCADE` |
| `public.organizer_voucher_claims.claimed_by` | `organizer_voucher_claims_claimed_by_fkey` | `NO ACTION` |
| `public.organizer_vouchers.created_by` | `organizer_vouchers_created_by_fkey` | `SET NULL` |
| `public.organizers.owner_user_id` | `organizers_owner_user_id_fkey` | `SET NULL` |
| `public.payment_gateway_configs.updated_by` | `payment_gateway_configs_updated_by_fkey` | `SET NULL` |
| `public.payment_gateway_state.updated_by` | `payment_gateway_state_updated_by_fkey` | `SET NULL` |
| `public.post_likes.user_id` | `post_likes_user_id_fkey` | `CASCADE` |
| `public.posts.author_user_id` | `posts_author_user_id_fkey` | `SET NULL` |
| `public.profiles.id` | `profiles_id_fkey` | `CASCADE` |
| `public.question_banks.owner_user_id` | `question_banks_owner_user_id_fkey` | `SET NULL` |
| `public.referral_codes.user_id` | `referral_codes_user_id_fkey` | `CASCADE` |
| `public.referral_events.referred_user_id` | `referral_events_referred_user_id_fkey` | `CASCADE` |
| `public.referral_events.referrer_user_id` | `referral_events_referrer_user_id_fkey` | `CASCADE` |
| `public.registrations.approved_by` | `registrations_approved_by_fkey` | `SET NULL` |
| `public.registrations.user_id` | `registrations_user_id_fkey` | `CASCADE` |
| `public.system_error_events.user_id` | `system_error_events_user_id_fkey` | `SET NULL` |
| `public.user_achievements.user_id` | `user_achievements_user_id_fkey` | `CASCADE` |
| `public.user_badges.awarded_by` | `user_badges_awarded_by_fkey` | `NO ACTION` |
| `public.user_order_history_archives.user_id` | `user_order_history_archives_user_id_fkey` | `CASCADE` |
| `public.user_product_entitlements.user_id` | `user_product_entitlements_user_id_fkey` | `CASCADE` |
| `public.user_roles.user_id` | `user_roles_user_id_fkey` | `CASCADE` |
| `public.user_settings.user_id` | `user_settings_user_id_fkey` | `CASCADE` |
| `public.xp_ledger.user_id` | `xp_ledger_user_id_fkey` | `CASCADE` |

## Migration guardrails

1. Do not execute a production FK migration from this snapshot alone. First prove every referenced UUID has a corresponding row in the identity root.
2. Add replacement constraints and validate them before dropping the old constraints.
3. Preserve the exact constraint names above to simplify rollback and application schema comparison.
4. Keep the 18 `SET NULL` relationships nullable and preserve attribution/audit rows.
5. Preserve the single `RESTRICT` relationship on `public.collective_registrations.teacher_user_id`.
6. Check the live catalog again immediately before any approved migration; this is a point-in-time snapshot, not a promise that production schema will never change.
7. Run the actual migration only against a complete reviewed local baseline first, then a separate hosted Free project when one is available. Production remains unchanged.

No DDL/DML was executed, no FK was altered, and no application data was modified while producing this snapshot.

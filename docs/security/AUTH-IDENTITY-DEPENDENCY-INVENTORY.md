# Supabase identity dependency inventory

Snapshot date: 4 November 2026  
Source: read-only PostgreSQL catalog queries against the current production project. No table rows or personal user records were exported.

## Executive summary

The application schemas `public` and `private` currently contain **69 foreign keys across 62 tables** referencing `auth.users(id)`:

| Schema | Foreign keys | Tables |
|---|---:|---:|
| `public` | 65 | 58 |
| `private` | 4 | 4 |
| **Total** | **69** | **62** |

Delete behavior is not uniform and must be preserved during any identity-root migration:

| Existing `ON DELETE` action | Count |
|---|---:|
| `CASCADE` | 42 |
| `SET NULL` | 18 |
| `NO ACTION` | 8 |
| `RESTRICT` | 1 |
| **Total** | **69** |

All 69 catalog entries observed were validated, non-deferrable foreign keys with `ON UPDATE NO ACTION`. Do not replace these constraints with one generic action. In particular, the 18 `SET NULL` relationships preserve audit/actor attribution rows when a user identity is removed; changing them to cascade could delete business history.

## Complete foreign-key inventory

These are the exact referencing schema/table/column names from the catalog snapshot. Constraint names were not changed.

### ON DELETE CASCADE (42)

- `private.collective_chat_realtime_sessions.auth_user_id`
- `private.referral_tier_awards.referrer_user_id`
- `public.ad_banner_requests.user_id`
- `public.addresses.user_id`
- `public.attempts.participant_id`
- `public.attempts.preview_owner_id`
- `public.awards.user_id`
- `public.certificates.user_id`
- `public.chat_blocks.blocked_id`
- `public.chat_blocks.blocker_id`
- `public.chat_group_invites.created_by`
- `public.chat_group_members.user_id`
- `public.chat_group_reads.user_id`
- `public.chat_groups.owner_user_id`
- `public.chat_messages.sender_id`
- `public.chat_spam_controls.user_id`
- `public.chat_thread_hidden.user_id`
- `public.chat_thread_reads.user_id`
- `public.chat_threads.participant_id`
- `public.chat_threads.user_id`
- `public.comment_likes.user_id`
- `public.comments.user_id`
- `public.daily_checkins.user_id`
- `public.daily_task_claims.user_id`
- `public.edu_coin_ledger.user_id`
- `public.notification_preferences.user_id`
- `public.notifications.user_id`
- `public.orders.user_id`
- `public.organizer_custom_plan_requests.requester_user_id`
- `public.organizer_members.user_id`
- `public.post_likes.user_id`
- `public.profiles.id`
- `public.referral_codes.user_id`
- `public.referral_events.referred_user_id`
- `public.referral_events.referrer_user_id`
- `public.registrations.user_id`
- `public.user_achievements.user_id`
- `public.user_order_history_archives.user_id`
- `public.user_product_entitlements.user_id`
- `public.user_roles.user_id`
- `public.user_settings.user_id`
- `public.xp_ledger.user_id`

### ON DELETE SET NULL (18)

- `private.referral_program_settings.updated_by`
- `public.ad_banners.user_id`
- `public.audit_logs.actor_user_id`
- `public.badge_audit_logs.actor_user_id`
- `public.chat_group_messages.sender_user_id`
- `public.comment_reports.reporter_user_id`
- `public.competition_status_history.changed_by`
- `public.grading_items.grader_id`
- `public.home_slides.created_by`
- `public.organizer_custom_plan_requests.reviewed_by`
- `public.organizer_vouchers.created_by`
- `public.organizers.owner_user_id`
- `public.payment_gateway_configs.updated_by`
- `public.payment_gateway_state.updated_by`
- `public.posts.author_user_id`
- `public.question_banks.owner_user_id`
- `public.registrations.approved_by`
- `public.system_error_events.user_id`

### ON DELETE NO ACTION (8)

- `private.organizer_access_codes.rotated_by`
- `public.badges.created_by`
- `public.chat_threads.handled_by`
- `public.collective_certificate_orders.payer_user_id`
- `public.currency_adjustment_logs.admin_id`
- `public.daily_checkin_settings.updated_by`
- `public.organizer_voucher_claims.claimed_by`
- `public.user_badges.awarded_by`

### ON DELETE RESTRICT (1)

- `public.collective_registrations.teacher_user_id`


## Functions and trigger dependencies on Supabase Auth

The live catalog contains **10 application functions** that depend directly on `auth.users`, its metadata, or the email-confirmation field. All 10 are marked `SECURITY DEFINER` in the inspected catalog.

| Function | Current dependency | Required migration treatment |
|---|---|---|
| `private.apply_referral_qualification(uuid,text,timestamptz)` | Reads `auth.users.email_confirmed_at` for the referred user before reward qualification | Read a trusted email-verification timestamp from the new identity root; retain the existing 24-hour checks, row locking and idempotent Edu Coin ledger behavior |
| `private.capture_signup_referral()` | Trigger reads `NEW.raw_user_meta_data.referral_id`; looks up referrer's `email_confirmed_at` | Move referral attribution to the trusted registration/provisioning lifecycle; never trust an arbitrary browser-supplied user ID or metadata as proof of ownership |
| `private.process_referral_email_confirmation()` | Trigger depends on `OLD/NEW.email_confirmed_at` transition; calls referral qualification | Replace with a trusted Better Auth verification event/worker provisioning operation; preserve the pending referral activity and timing rules |
| `public.create_organizer(text,text)` | Reads email confirmation, `phone_confirmed_at`, and `phone` from `auth.users` | Preserve email AND verified-phone checks, minimum phone length, uniqueness hash and organizer-role checks. Current Worker POC does not yet establish a phone-verification replacement; this is an explicit blocker for the corresponding feature |
| `public.get_my_referrals()` | Joins `auth.users` for `last_sign_in_at` | Replace with a deliberately maintained last-sign-in projection or inspect frontend contract before removing this field |
| `public.get_my_referrals_v2()` | Joins `auth.users` for `last_sign_in_at` | Same as above; preserve return shape or version the RPC and caller together |
| `public.get_my_verified_referrals()` | Joins `auth.users` for `last_sign_in_at` | Same as above |
| `public.handle_new_auth_user()` | Auth trigger reads `NEW.raw_user_meta_data`; provisions `profiles`, `user_roles`, and `user_settings` | Replace with a trusted, idempotent provisioning operation. Preserve approved basic account-type mapping, reject client-controlled privileged role grants, and avoid overwriting an existing profile on retry |
| `public.register_for_competition(...)` | Looks up a referrer's `email_confirmed_at` before recording referral attribution | Replace the lookup with the new identity root's trusted email-verification state; preserve the competition registration and referral reward rules |
| `public.verify_pending_referrals()` | Joins `auth.users` and requires email confirmation before qualification | Read the new verified state; preserve time windows, qualifying activity search, row status and idempotent ledger behavior |

### Current auth.users triggers

There are exactly three non-internal triggers on `auth.users` in this snapshot:

| Trigger | Event | Current function | Replacement responsibility |
|---|---|---|---|
| `on_auth_user_created` | AFTER INSERT | `public.handle_new_auth_user()` | Transaction-safe application identity/profile/role/settings provisioning |
| `trg_referral_signup_attribution` | AFTER INSERT | `private.capture_signup_referral()` | Signup referral attribution after the user identity has been validated |
| `trg_referral_email_confirmed` | AFTER UPDATE OF `email_confirmed_at`, null → non-null | `private.process_referral_email_confirmation()` | Trusted event after Better Auth email verification |

## RLS and auth.uid() dependencies

The current snapshot has **109 RLS policies** using `auth.uid()`. The earlier function inventory also recorded **188 SQL functions** using `auth.uid()`.

The migration should not mass-rewrite every use of `auth.uid()`. With the accepted Supabase external JWT contract, `auth.uid()` must continue to resolve the Better Auth UUID from JWT `sub`. A disposable local Supabase CI fixture has now verified the base PostgreSQL behavior for one synthetic two-user RLS policy: UUID mapping, owner-only read, permitted owner insert, denial of cross-user read, forged-owner insert and ownership-transfer denial. This is a narrow contract test; it does **not** prove that the full set of 109 production policies or hosted Custom OIDC is correct.

## Stage 3 design requirements derived from this inventory

1. Create `private.app_users` as the canonical app identity root keyed by the same Better Auth UUID, with only the trusted app-side identity/verification projection that the database genuinely needs.
2. Migrate all 69 foreign keys to that root, preserving each exact `ON DELETE` behavior and the current `ON UPDATE NO ACTION` behavior. `profiles.id` should reference the identity root; do not create shadow rows in `auth.users`.
3. Before swapping any constraint, prove that every referenced UUID has a corresponding identity-root row. Keep existing application rows and relationships; do not silently null, delete or invent users.
4. Replace the three auth triggers and ten dependent functions as a coordinated lifecycle change. In particular, preserve verified-phone semantics for organizer creation and the referral reward/idempotency contract.
5. Preserve the external JWT contract (`sub` = Better Auth UUID; PostgreSQL `role=authenticated`; business roles remain in app tables) and add issuer restrictions where required.
6. Test both positive and negative cases using synthetic users A/B and realistic fixture dependencies before proposing any production migration.
7. Inspect frontend callers for referral `last_login_at` before deciding how `last_sign_in_at` is maintained or whether the RPC contract needs a coordinated version.

## Safety boundary

This document records catalog metadata only. It does not contain user rows, emails, credentials or production tokens. No migration, trigger replacement, role change, account deletion or production data write was performed. Production remains on Supabase Auth until all seven approved stages and rollback gates have passed.

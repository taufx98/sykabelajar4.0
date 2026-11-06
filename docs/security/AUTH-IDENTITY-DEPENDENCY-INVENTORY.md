# Supabase identity dependency inventory

Snapshot date: originally 5 November 2026; selected catalog counters revalidated 6 November 2026  
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

All 69 catalog entries observed were validated, non-deferrable foreign keys with `ON UPDATE NO ACTION` (catalog recheck: not_validated=0, deferrable=0, non_no_action_updates=0). Do not replace these constraints with one generic action. In particular, the 18 `SET NULL` relationships preserve audit/actor attribution rows when a user identity is removed; changing them to cascade could delete business history.

## Complete foreign-key inventory

The exact original constraint names, referencing columns, and `ON DELETE` actions are listed in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). It includes all 69 catalog rows and confirms all 18 `SET NULL` source columns are nullable. The summary below groups the referencing schema/table/column names by delete action.

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
| `public.get_my_referrals()` | Joins `auth.users` for `last_sign_in_at` | No active frontend caller found for this legacy RPC. Do not add a new last-sign-in sync solely for this field; keep a compatible null field temporarily or remove only after API-contract review |
| `public.get_my_referrals_v2()` | Joins `auth.users` for `last_sign_in_at` | `ReferralProgramPanel.tsx` is the active caller, but does not read `last_login_at`. Keep the output field as `NULL` for temporary shape compatibility or remove only after contract review; no current UI need for login-time synchronization was found |
| `public.get_my_verified_referrals()` | Joins `auth.users` for `last_sign_in_at` | No active frontend caller found. Keep compatibility only if there is an external consumer; otherwise consider retiring it together with the legacy RPC after reviewing grants/dependencies |
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

## Supabase Edge Functions that call Auth getUser

A repository-wide source search on the default application branch also found four current Edge Functions that call \`supabase.auth.getUser()\` with the caller's Bearer token. These are not additional SQL functions or foreign keys, but they are important Stage 5 compatibility points because the new identity provider will issue JWTs without creating matching \`auth.users\` rows.

| Edge Function | Current identity dependency | Behavior that must be preserved |
|---|---|---|
| \`get-cloudinary-signature\` | Calls \`supabase.auth.getUser()\` before signing a Cloudinary upload request | Reject unauthenticated requests. Continue validating the caller before creating upload signatures; also retain upload folder/preset and allowed public ID restrictions. |
| \`payment-gateway-create\` | Calls \`auth.getUser()\`, then uses service-role queries to load an order and compares \`orders.user_id\` to \`authData.user.id\` | A caller must only create a checkout session for their own order. Preserve the explicit ownership comparison before any service-role work. |
| \`payment-gateway-reconcile\` | Calls \`auth.getUser()\`, then uses service-role order/payment intent lookups and compares order owner | A caller must only reconcile their own order. Keep provider verification, amount/currency checks, idempotency and fulfillment rules unchanged. |
| \`payment-gateway-admin\` | Calls \`auth.getUser()\`, then calls \`is_active_admin(p_uid)\` with the caller-scoped JWT before creating a service-role client | Preserve the authenticated user's JWT context for the database admin check. Do not replace this with a caller-supplied UUID or a service-role-only lookup. Service role may be used only after the admin RPC approves the caller. |

Supabase's current third-party-auth documentation says third-party JWTs are supported across Data API, Storage, Realtime and Edge Functions. Its current Edge Functions guide recommends verified user context and \`userClaims\` via \`@supabase/server\`'s \`withSupabase({ auth: 'user' })\` wrapper. That does **not** by itself prove that the existing \`supabase.auth.getUser()\` GoTrue lookup in these four older functions will return a Better Auth identity that is not present in \`auth.users\`. Stage 5 must therefore validate this exact behavior against a hosted isolated Free project when a slot is available, and can then move the handlers to platform-verified \`userClaims.sub\`/JWT context where appropriate. Do not disable platform JWT verification to work around a failing \`getUser()\` call, and do not trust an unverified decoded JWT.

Official references:
- [Supabase third-party auth overview](https://supabase.com/docs/guides/auth/third-party/overview) — documents third-party JWT support for Edge Functions.
- [Supabase securing Edge Functions](https://supabase.com/docs/guides/functions/auth) — documents the \`user\` auth mode and verified \`userClaims\`.
- [Supabase Custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc) — documents external issuer, signature, \`kid\`, \`role\`, and JWT requirements.

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
7. Frontend search found `ReferralProgramPanel.tsx` as the active caller of `get_my_referrals_v2`, but it does not consume `last_login_at`; no active frontend caller was found for the legacy `get_my_referrals()` or `get_my_verified_referrals()`. A compatible `NULL` output can avoid adding sign-in synchronization solely for an unused UI field, subject to API-contract review.

## Safety boundary

This document records catalog metadata only. It does not contain user rows, emails, credentials or production tokens. No migration, trigger replacement, role change, account deletion or production data write was performed. Production remains on Supabase Auth until all seven approved stages and rollback gates have passed.


## Live catalog revalidation — 5 November 2026

The live production catalog was queried again read-only and compared row by row with the committed metadata-only file `scripts/auth-migration/live-auth-users-fk-catalog.json`:

- **69 current application FKs vs 69 snapshot FKs**.
- Missing constraints: 0; added constraints: 0; changed semantics: 0.
- All 18 `SET NULL` source columns remain nullable.
- Internal `auth` schema FKs remain excluded from the application migration (10 internal constraints).
- `private.app_users` still does not exist; `auth.users` currently has 10 rows (count only; no identity values were exported).
- Three non-internal `auth.users` triggers remain.
- 109 RLS policies still reference `auth.uid()`.

The direct auth dependency recheck confirms these ten functions: `private.apply_referral_qualification`, `private.capture_signup_referral`, `private.process_referral_email_confirmation`, `public.create_organizer`, `public.get_my_referrals`, `public.get_my_referrals_v2`, `public.get_my_verified_referrals`, `public.handle_new_auth_user`, `public.register_for_competition`, and `public.verify_pending_referrals`.

This is a catalog-only comparison. It does not apply a migration, export application rows, or prove a full schema restore. The complete schema-only baseline must still be created from the owner's trusted local machine and validated before writing an executable Stage 3 migration.

## Security Advisor review snapshot — 5 November 2026

The read-only Supabase Security Advisor reported:

- 23 RLS-enabled tables with no policies (INFO). Verify intended private/internal use before creating any policy.
- 46 `SECURITY DEFINER` functions callable by `anon` (WARN).
- 202 `SECURITY DEFINER` functions callable by `authenticated` (WARN).
- Leaked-password protection disabled (WARN).

A linter warning is not enough to classify a function as exploitable. Stage 5 must inspect function bodies, owner checks, issuer checks and grants individually. Do not revoke all `EXECUTE` privileges or make all functions `SECURITY INVOKER` without understanding the contract; exam participant and public verification flows may intentionally support non-authenticated calls.


## Live recheck update — 6 November 2026

A fresh read-only production query on 6 November confirmed the following selected counters: `private.app_users` is absent; 69 application FKs still target `auth.users(id)`; 3 non-internal triggers remain on `auth.users`; 109 policies reference `auth.uid()`; and `auth.users` contains 11 rows (count only). Eight public/private SQL functions directly reference `auth.users` in their function definitions. This direct-source count is not a replacement for the broader set of 10 functions/triggers that depend on the Auth metadata and email/phone verification lifecycle.

The connected Supabase deployment currently exposes 15 active Edge Functions. A read-only source audit of the relevant current deployed versions found four user-facing functions still calling `supabase.auth.getUser()`:
- `get-cloudinary-signature` v11
- `payment-gateway-create` v5
- `payment-gateway-reconcile` v1
- `payment-gateway-admin` v5

The older `midtrans-create-payment` v10 is a compatibility delegator to `payment-gateway-create`; it is not a separate identity verifier. `payment-webhook` and `payment-gateway-webhook` use their own signed-webhook authentication and must remain distinct from user-token verification. Do not replace their signature checks with user JWT checks.

**Stage 5 implementation note (verified against current Supabase documentation, 6 November 2026):** do not merely decode a Better Auth JWT in an Edge Function, and do not assume `auth.getUser()` can resolve a Better Auth identity from `auth.users`. For user-invoked functions, evaluate the current `@supabase/server` `withSupabase({ auth: 'user' })` wrapper while keeping `verify_jwt = true`; it exposes verified `userClaims` / `jwtClaims` and an RLS-scoped client. Preserve privileged server-side operations only where explicitly required, with owner/business-role checks and secret keys held server-side. Validate the custom issuer, subject, audience and cross-user denial with two synthetic users in the isolated hosted Supabase acceptance environment before deploying any function changes. Official guide: https://supabase.com/docs/guides/functions/auth.

Latest Security Advisor snapshot (observed 6 November 2026 09:13 UTC):
- 23 RLS-enabled tables with no policies (INFO; review intended private/internal use individually).
- 46 SECURITY DEFINER functions callable by `anon` and 202 callable by `authenticated` (WARN; audit each function body, grants, search_path and role/issuer checks; no blanket revoke).
- Leaked-password protection disabled (WARN; confirm availability/cost before changing).
- Performance review: 41 unindexed foreign keys, 13 auth-RLS init-plan findings, 86 unused indexes and 26 multiple-permissive-policy findings. These are separate, scoped optimization/security review items; do not mass-change indexes or policies as part of the identity migration.

No schema, data, Auth provider settings, Edge Functions, secrets or production accounts were modified by these checks.


## Full table/RLS and private organizer-code access recheck — 6 November 2026

A metadata-only Supabase table inventory via `list_tables(verbose=true)` reports 125 application tables across `public` (120) and `private` (5). RLS is enabled on 124; the only table reported without RLS is `private.organizer_access_codes`. No table rows or personal records were read by this inventory.

A separate permission query confirms `anon` and `authenticated` have neither `USAGE` nor `CREATE` on the `private` schema and have no direct SELECT/INSERT grants on `private.organizer_access_codes`. The table is accessed by four `SECURITY DEFINER` functions: `public.admin_create_organizer`, `public.create_organizer`, `public.join_organizer` and `public.rotate_organizer_access_code`. None is executable by `anon`; all four are executable by `authenticated`. Their authorization guards and fixed `search_path` settings were inspected read-only. Three use `search_path=public,private`; `rotate_organizer_access_code` uses an empty search path and schema-qualified references.

This does not by itself establish an exploitable exposure: direct schema/table privileges deny public access and the functions contain operation-specific caller checks. Do not blanket-enable RLS on this private table or revoke function grants without evaluating every intended organizer flow. Stage 5 must preserve the access-code hash-only storage, admin/organizer-manager authorization, and UUID caller checks while replacing the `auth.users` dependency in `create_organizer` with a separately verified email/phone projection. The phone-confirmation requirement remains a hard migration gate.


## Anonymous SECURITY DEFINER RPC triage — 6 November 2026

The fresh 6 November Security Advisor count of 46 `anon`-callable SECURITY DEFINER functions is now classified in [AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md](AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md). The first-pass triage separates four admin-only functions whose anonymous ACL should be tightened after caller review; signed-in/owner-specific functions; 15 guest participant/portal endpoints whose boundary is hashed bearer-session tokens; and public read/telemetry projections that must remain available only for intentionally published data.

This is a source/ACL triage, not a completed pen-test of all 46. No grants were revoked or expanded. In particular:
- PR [#174](https://github.com/taufx98/sykabelajar4.0/pull/174) addresses a confirmed anonymous NULL-semantics/private-profile bypass in `get_profile_connections` and the related `get_public_profile_social` visibility boundary. CI passed [#41767330665](https://github.com/taufx98/sykabelajar4.0/actions/runs/41767330665), but it is still Draft/unmerged and needs isolated PostgreSQL integration validation before the production issue can be called fixed.
- The public results RPC currently includes `participant_code`, and the results UI renders it; the collective portal also uses that code in its second-step participant-session operation. This is a data-minimisation risk to evaluate without breaking the authenticated portal-token flow. No behavior changed.
- Of 23 RLS-enabled tables without policies, 20 deny direct SELECT/INSERT to anon/authenticated; three tables have table grants but no policy and therefore remain default-deny for these API roles under RLS. No blanket policy or grant change is appropriate.

Stage 5 still requires isolated tests for admin-only ACLs, token-bound guest endpoints (wrong/expired/revoked/cross-participant tokens and replay), public endpoints against private/unpublished records, PR #174, and the new issuer's two-user IDOR matrix.

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

This is a catalog-only comparison. It does not apply a migration, export application rows, or prove a full schema restore. The complete schema-only baseline must still be exported and restored in a disposable environment before writing an executable Stage 3 migration. The automated GitHub Actions path is prepared; it awaits the repository secret `SUPABASE_DB_URL` and does not require owner CLI work.

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

Latest Security Advisor snapshot (observed 6 November 2026 09:44 UTC):
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


## Full deployed Edge Function recheck — 6 November 2026

## Full deployed Edge Function recheck — 6 November 2026

A fresh read-only source download covered all 15 currently active production Edge Functions. The earlier `auth.getUser()`-only search found four endpoints but missed four Cloudinary functions that call `/auth/v1/user` directly, plus a delete endpoint that checks only for Bearer-header presence.

The current user-identity migration surface is therefore:
- `get-cloudinary-signature` v11 — Supabase `auth.getUser()`; live version does not bind the requested `public_id` to the caller. The branch adds profile/organizer ownership checks, not deployed.
- `cloudinary-profile-upload` v9 and `cloudinary-profile-upload-v2` v9 — manual `/auth/v1/user` verification; both derive UUID-based profile/cover IDs from the returned user.
- `cloudinary-delete-asset` v9 — platform `verify_jwt=true`, but handler only checks for a Bearer header and does not resolve a caller UUID or compare it to the requested `public_id`. This is a high-priority owner-check gap. The branch now carries a replacement that validates the legacy Supabase Auth caller and restricts deletion to that caller's exact UUID-based avatar/cover IDs; not deployed.
- `cloudinary-delete-asset-v2` v9 and `cloudinary-delete-profile` v9 — manual `/auth/v1/user` verification and exact owner UUID path restrictions.
- `payment-gateway-admin` v5, `payment-gateway-create` v5 and `payment-gateway-reconcile` v1 — direct `supabase.auth.getUser()` calls. Keep caller-context `is_active_admin()`, order owner UUID checks and payment provider signature/amount/idempotency checks when migrating.
- `midtrans-create-payment` v10 — authorization-header compatibility delegator to `payment-gateway-create`, not a second independent user verifier.

The six Cloudinary endpoints plus three payment endpoints produce **nine active user-facing Edge Function implementations** that depend on the Supabase Auth identity model or require caller-ownership enforcement, plus one legacy payment delegate. The four direct `auth.getUser()` endpoints are a subset, not the complete count.

The following deployed endpoints retain independent/public authentication and are not user-JWT migrations: `payment-webhook` v9 and `payment-gateway-webhook` v4 (provider signatures, `verify_jwt=false`); `payment-gateway-public` v2 (deliberately public status); `generate-collective-certificate-pdf` v8 (public certificate output); `cleanup-expired-chat-media` v9 (service-role cleanup with `verify_jwt=false`, to be retired with the approved private-chat removal).

No production Edge Function code, config, secret, Cloudinary asset or Supabase Auth setting was modified. The exact per-function details and required synthetic A/B tests are in [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md).


## Live dependency and schema revalidation — 7 November 2026

Source: read-only catalog queries against production project `mvdczyitbkxkldjughor`. No application rows, UUID values, email addresses, credentials, or tokens were selected. No DDL/DML was executed.

### Current identity-root and Auth dependency state

- PostgreSQL server version: **17.6**.
- `private.app_users`: **does not exist**.
- `auth.users`: **11 rows** (count only; no user records were read).
- Application foreign keys from `public`/`private` to `auth.users(id)`: **69**.
- RLS policies containing `auth.uid()`: **109**.
- Non-internal triggers on `auth.users`: **3**.
- Views whose definitions reference `auth.users` or `auth.uid()`: **0**.

The 10 function dependencies remain the correct migration inventory. A new source-level distinction from the 7 November scan is useful:

| Dependency class | Functions | Treatment |
|---|---|---|
| Eight function definitions with direct `auth.users` table references | `private.apply_referral_qualification`, `private.capture_signup_referral`, `public.create_organizer`, `public.get_my_referrals`, `public.get_my_referrals_v2`, `public.get_my_verified_referrals`, `public.register_for_competition`, `public.verify_pending_referrals` | Replace the direct table reads with the trusted identity projection where appropriate. Preserve the existing RPC output shapes and business rules. |
| Two trigger functions that consume the `auth.users` row through `NEW`/`OLD` rather than querying the table by name | `public.handle_new_auth_user`, `private.process_referral_email_confirmation` | Keep the legacy Supabase Auth trigger path during the overlap period. Better Auth provisioning and verification use the server-only Stage 3 RPC path. Retire the legacy path only with the approved login cutover. |

The three production Auth triggers remain:
- `on_auth_user_created` → `public.handle_new_auth_user()`
- `trg_referral_signup_attribution` → `private.capture_signup_referral()`
- `trg_referral_email_confirmed` → `private.process_referral_email_confirmation()`

The 109 `auth.uid()` policies are not a reason to mass-rewrite policy expressions. Stage 2 hosted acceptance already demonstrated that a Better Auth UUID in the accepted JWT `sub` resolves through `auth.uid()` and that a two-user RLS fixture separates ownership. The full 109-policy regression remains a later acceptance requirement; this is not proof that every policy is correct.

### Production schema differences that the synthetic fixture must not hide

The live catalog shows several differences that must be included in the full local baseline and migration tests:

- `public.profiles` is the existing production table, not the minimal fixture table. It has the live unique username index and account-type constraint plus existing normalization, account-type backend guard, currency backend guard, and updated-at triggers. Provisioning must continue to pass through those database protections and preserve profile fields not owned by registration.
- `public.user_roles` uses the existing `public.app_role` enum and composite `(user_id, role)` key. The production enum and role rows must be preserved; retries must not reactivate a role that was disabled.
- `private.referral_program_settings` contains additional live event, milestone, promo, and audit fields beyond the simplified synthetic fixture. A migration must preserve the full production row/table definition and not replace it with the fixture shape.
- `public.referral_events` and `public.edu_coin_ledger` have live uniqueness constraints used by referral attribution and idempotent rewards. The reward pipeline must preserve the unique ledger key and one-referral-per-referred-user behavior.
- `private.organizer_free_identity_claims` has a unique identity hash and unique owner claim. The existing organizer flow hashes the normalized verified phone digits with SHA-256; a profile WhatsApp value or an unchecked client hash is not an acceptable substitute.
- Existing profile triggers include `profiles_account_type_backend_guard`, `profiles_currency_backend_guard`, `trg_profiles_normalize_fields`, and `trg_profiles_updated_at`. The local fixture must exercise the trusted provisioning path against equivalent behavior, not simply omit the guards.

### Function-level migration and regression requirements

1. `private.apply_referral_qualification`: replace the old `auth.users.email_confirmed_at` read with `private.app_users.email_verified_at`; preserve row locking, first eligible activity, strict 24-hour checks, and the idempotent Edu Coin ledger credit.
2. `public.register_for_competition`: the optional referral lookup must validate the referrer against trusted `email_verified_at` without changing registration, audit-log, or notification behavior.
3. `public.verify_pending_referrals`: use the identity projection for referred-user email verification; preserve activity lookup order, referral status transitions, reward snapshot, and single-credit behavior.
4. `public.get_my_referrals()`, `get_my_referrals_v2()`, and `get_my_verified_referrals()`: these read `auth.users.last_sign_in_at` only for the legacy `last_login_at` output. Keep the original 8/9/5-column return contracts and return a typed `NULL` for `last_login_at`; do not mirror sign-ins. The Stage 3 draft now explicitly uses an empty `search_path` and grants execution to `authenticated` only (revoking PUBLIC, anon and service_role). The 9 November regression invokes all three RPCs, checks the legacy columns/NULL value and verifies anonymous/service-role denial. The current active `ReferralProgramPanel` uses `get_my_referrals_v2()` and does not consume `last_login_at`.
5. `public.create_organizer`: preserve the verified-email AND verified-phone requirements, the minimum normalized phone length, active `organizer_member` role check, one-workspace limit, SHA-256 identity hash, and unique free-organizer claim. A server-bound Telegram OIDC verification path and private boolean status RPC are now present in the Stage 3 draft and disposable fixture. Hosted consent/callback acceptance and the production-safe rollout gate remain open; do not substitute a client-supplied phone hash.
6. `private.capture_signup_referral`, `public.handle_new_auth_user`, and `private.process_referral_email_confirmation`: these are part of the old Supabase Auth trigger path. Do not disable them during preparation. The new Better Auth path uses the trusted provisioning and email-verification RPCs; retire the old triggers only at the approved cutover after confirming the old signup path is no longer used.
7. Keep all `auth.uid()` RLS and SQL caller identity behavior tied to the accepted JWT `sub`; preserve `role=authenticated` and keep SYKABELAJAR business roles in `public.user_roles`.

The disposable full-schema production-shaped regression now runs after the actual schema-only export/restore. It exercises the Better Auth provisioning/referral/email/phone/organizer lifecycle, the referral qualification, competition registration and pending-referral paths, commerce/order/payment/exam/teacher-roster ownership cases, representative admin/participant/anonymous RLS behavior, all 69 FK relationships, issuer restrictions, and rollback. This is materially stronger than the earlier synthetic fixture, but it is not a claim that every output branch of all ten Auth-dependent functions or every one of the 109 policy operations has exhaustive acceptance coverage. Remaining focused tests should cover the legacy referral read RPC return-column contract (`get_my_referrals*`), full profile-trigger parity, and any trigger overlap that is still reachable before cutover.

### Outstanding prerequisites

- A full schema-only production dump and disposable PostgreSQL 17.6/Supabase restore were successfully executed and verified by [Auth Production Schema Baseline #42469223582](https://github.com/taufx98/sykabelajar4.0/actions/runs/42469223582). The ephemeral dump and temporary restore were removed by workflow cleanup and were not committed or uploaded. Re-run the guarded workflow for any later schema-drift review; do not treat the previous ephemeral dump as a permanent artifact.
- The server-bound Telegram phone-verification path and boolean status RPC are implemented in the Better Auth Worker/client and Stage 3 draft/fixture. A live Telegram bot/consent callback and hosted end-to-end acceptance are still pending; organizer creation must continue to fail closed until the trusted phone projection is installed.
- No production identity table, foreign key, trigger, function, RLS policy, account, or login configuration has been changed.



### RLS policy coverage revalidation — 7 November 2026

A second read-only scan classified all policies whose `USING` or `WITH CHECK` expression contains `auth.uid()`:

- **109 policies across 61 tables**: 108 in `public`, 1 in `private`.
- `auth.uid()` appears in 90 `USING` expressions and 42 `WITH CHECK` expressions (some policies contain both).
- Command distribution: SELECT 55 (54 public + 1 private), INSERT 19, UPDATE 12, DELETE 12, and ALL 11.
- No policy expression in this 109-policy set directly references `auth.users`.

This is a measurable regression surface for the identity cutover. Tests must include at least one positive and negative ownership case per materially distinct policy pattern and cover the high-risk data domains; the Stage 2 synthetic two-user fixture is not a substitute for this 61-table policy review. Keep the accepted Better Auth JWT contract (`sub` = identity UUID, PostgreSQL `role=authenticated`, exact issuer) and do not rewrite `auth.uid()` policy expressions merely to change the identity provider.


## Hosted Stage 3 fixture validation — 7 November 2026

The existing isolated Free project `sykabelajar-auth-staging` (`ydamszdfsxqisanazdkb`) was reused for namespaced synthetic Stage 3 tests after a catalog collision check. It already contained the Stage 2 `public.auth_oidc_acceptance_rows` fixture; that table and its two synthetic rows were preserved.

The following Stage 3-only fixture migrations were applied to this staging project:
- A protected `private` schema and synthetic `private.legacy_auth_users` / `private.app_users` identity-root tables.
- Four synthetic public FK child tables covering `CASCADE`, `SET NULL`, `NO ACTION`, and `RESTRICT`.
- Simplified synthetic `profiles`, `user_roles`, `user_settings`, referral settings/codes/events, Edu Coin ledger, daily check-ins, and trusted provisioning/referral functions.
- pgTAP 1.3.3 for hosted assertions.

Hosted pgTAP results, run with `extensions.finish(true)` so a failed assertion aborts the test:
- `identity_fk_rehome.test.sql`: **12/12 assertions passed**.
- `identity_provisioning_referral.test.sql`: **68/68 assertions passed**.
- **Total hosted Stage 3 synthetic coverage: 80/80 assertions passed.**

Both test scripts wrap their assertions and test mutations in transactions and roll back. A read-only post-test catalog check confirmed the four fixture FKs still reference the legacy synthetic parent (four legacy, zero replacement FKs), `private.app_users` contains zero rows, and the two pre-existing OIDC fixture rows remain. Thus the tests did not leave the rehome operation or test-created identities in place.

A post-install security inventory found five newly created test tables without RLS (the four public FK child fixtures and the private legacy parent). These were hardened in the staging project: RLS is enabled and forced on all five, and direct grants to `PUBLIC`, `anon`, and `authenticated` are revoked. A subsequent table inventory confirmed RLS enabled on every fixture table. The private app identity and provisioning tables also retain their service-role-only table privileges.

**Scope limitation:** this is hosted PostgreSQL behavior against a synthetic schema, not a production schema rehearsal. It does not validate the exact production `create_organizer`, `register_for_competition`, or `verify_pending_referrals` definitions; the three production Auth-trigger overlap behaviors; every production profile trigger/constraint; or all 109 production `auth.uid()` policies. The trusted verified-phone path for `create_organizer` remains unresolved. The fixture's simplified function bodies must not be mistaken for replacements ready to deploy.

No production schema, data, Auth user, FK, trigger, function, RLS policy, issuer setting, secret, or login route was changed.


## Production definition-level revalidation — 7 November 2026

The following details were read directly from PostgreSQL catalogs using `pg_get_functiondef`, `pg_get_triggerdef`, `information_schema.columns`, and function ACL checks. Queries were metadata-only; no application rows, email addresses, identity UUIDs, or secrets were selected.

### Auth-trigger behavior that must be replaced as a lifecycle

The three production `auth.users` triggers and their exact timing are:

| Trigger | Timing | Important behavior |
|---|---|---|
| `on_auth_user_created` | AFTER INSERT | Calls `public.handle_new_auth_user()`; bootstraps profile, mapped business role and settings. |
| `trg_referral_signup_attribution` | AFTER INSERT | Calls `private.capture_signup_referral()`; reads `raw_user_meta_data.referral_id` as a UUID, checks that the referrer email is confirmed, snapshots reward settings, and inserts one pending referral event. |
| `trg_referral_email_confirmed` | AFTER UPDATE OF `email_confirmed_at`, only NULL → non-NULL | Calls `private.process_referral_email_confirmation()`; locks the pending event, checks the first eligible activity occurred inside 24 hours, then asks the qualification function to award the referral. |

The new Better Auth flow does not create an `auth.users` row and has no `raw_user_meta_data` trigger context. Therefore these are not triggers that can simply be recreated on `private.app_users` without changing their event model. Better Auth's trusted provisioning callback and trusted email-verification callback must own the equivalent lifecycle. The current synthetic fixture exercises the new callback model, not these legacy Auth triggers.

### Referral activity sources and exact trigger surface

The production function `private.capture_referral_activity()` is attached to:
- `daily_checkins` AFTER INSERT;
- `comments` AFTER INSERT;
- `follows` AFTER INSERT;
- `daily_task_claims` AFTER INSERT when status is COMPLETED and `completed_at` is non-NULL;
- `daily_task_claims` AFTER UPDATE OF status/completed_at when the row transitions into a completed state.

The function body also contains a `chat_messages` branch, but the catalog query did not find an active trigger on that table at this checkpoint. Separately, `public.verify_pending_referrals()` still scans `chat_messages` as one of its five fallback activity sources. Preserve or retire that legacy activity treatment only after checking the product's chat-removal/data-retention state; it must not be silently changed as part of the auth-provider swap.

`private.apply_referral_qualification()` still accepts the activity names `daily_checkin`, `comment`, `follow`, `chat`, and `daily_task`. It locks the pending event, records the first eligible activity, enforces the 24-hour window, reads the trusted email-confirmation field, and uses the unique Edu Coin ledger key before crediting the referrer. The hosted fixture tested the reduced new callback flow, not every production activity trigger.

### Signup referral input is not identical across old call paths

The existing `private.capture_signup_referral()` expects `raw_user_meta_data.referral_id` to contain a UUID. The existing `public.register_for_competition(..., p_referral_code)` accepts either an upper-cased referral code resolved through `public.referral_codes` or a UUID string, rejects self-referral, then checks the referrer's `auth.users.email_confirmed_at` before creating a pending event.

The Better Auth registration fixture resolves a referral **code** from `public.referral_codes` and checks the trusted identity projection. Before production replacement, define one explicit server-side resolver for registration and competition attribution; retain any required UUID compatibility, case handling, self-referral exclusion, reward-setting snapshot, and the unique referred-user/registration constraints. Do not trust client-provided referrer UUIDs without resolving and checking them server-side.

### Profile projection and trigger compatibility

The production `public.profiles` table has **36 columns**, not the simplified fixture shape. Its four non-internal triggers are:
- `trg_profiles_normalize_fields`: normalizes username, institution and full name;
- `profiles_account_type_backend_guard`: blocks client-side account_type mutation;
- `profiles_currency_backend_guard`: blocks client-side Edu Coin/XP mutation;
- `trg_profiles_updated_at`: maintains updated_at.

The legacy `handle_new_auth_user()` inserts profile fields including full name, username, grade, birth date, institution, school ID, guardian name, account type, WhatsApp and subjects. Its conflict path updates most of those values on retry. It also uses `ON CONFLICT ... DO UPDATE SET is_active = true` for the mapped business role. The Better Auth provisioning contract intentionally differs for safety: retries must not overwrite an already-created profile and must not reactivate a role an administrator disabled. Tests must still verify the real production profile triggers and every relevant column/default/constraint after restoring the full schema.

Profile fields also include Cloudinary asset references and dimensions/versions for avatar and cover. Keep these as application metadata/references; do not migrate binary media into Supabase Storage or change the media provider as part of this auth work.

### Function execution grants are part of the migration contract

A live ACL check found:
- The three private Auth/referral trigger functions and `private.apply_referral_qualification()` are not directly executable by `anon`, `authenticated`, or `service_role`; they are owned/executable by `postgres` and reached through trusted trigger/internal calls.
- `public.handle_new_auth_user()` is directly executable by `service_role`, not by `anon` or `authenticated`.
- `public.create_organizer`, `public.register_for_competition`, and `public.get_my_referrals()` / `v2` are executable by `authenticated` and `service_role`, not `anon`.
- **`public.get_my_verified_referrals()` is currently executable by `anon`, `authenticated`, and `service_role`.** Its query filters on `auth.uid()`, so an anonymous caller normally has a NULL caller UUID and should not receive another user's referrals, but the anonymous EXECUTE grant is broader than the other referral RPCs. Review its actual external callers and the identity/RLS contract before replacing it; do not blindly copy the ACL into a Better Auth migration.

All new provisioning/email-verification PostgREST wrappers must remain service-role-only, while user-facing RPCs must retain caller-scoped `auth.uid()` checks and operation-specific authorization. Do not use a broad default grant for new SECURITY DEFINER functions.

These exact production findings make the current 80/80 hosted synthetic assertions useful but insufficient for a full-schema production migration. No production function, trigger, grant, profile column, or policy was changed.


### Frontend consumers and scheduler recheck — 7 November 2026

A branch source recheck confirms `src/components/referrals/ReferralProgramPanel.tsx` is the current frontend caller of `public.get_my_referrals_v2()`. The component stores the RPC rows as `ReferralRow[]`; it does not reference or render `last_login_at`. No current frontend reference to `public.get_my_verified_referrals()` was found in the branch source search; the function name remains in its historical SQL migration. The live catalog still reports its EXECUTE grant to `anon`, so retain this as an ACL cleanup/review candidate rather than treating it as an active product requirement.

A read-only query of production `cron.job` returned no job whose command calls `verify_pending_referrals()` at this checkpoint. The SQL function exists, and its exact body still scans five fallback activity sources, but do not assume an hourly pg_cron invocation is currently active. Check the intended scheduler owner and deployment mechanism before restoring or changing scheduling as part of the identity migration.


## Trusted organizer phone verification — Telegram OIDC (7 November 2026)

A free, consent-based candidate for the production verified-phone requirement has now been implemented as a **phone-verification step only**, not as a SYKABELAJAR sign-in provider. Official Telegram Login documentation confirms Authorization Code + PKCE S256, the `openid phone` scopes, a signed ID token, and the `phone_number_verified: true` claim when the user consents to share a verified phone number. It documents the issuer `https://oauth.telegram.org`, token endpoint `https://oauth.telegram.org/token`, and JWKS endpoint `https://oauth.telegram.org/.well-known/jwks.json`.

Worker-side implementation added on this branch:
- one-use 10-minute D1 challenge with random state (stored as SHA-256), nonce, and PKCE verifier;
- atomic per-user cooldown reservation and on-demand expiry cleanup;
- server-only token exchange using BotFather client credentials;
- RS256-only ID-token signature, issuer, audience, nonce, expiration and freshness validation;
- require `phone_number_verified === true` and a valid international 8–15 digit number;
- project only the digits-only SHA-256 phone identity hash, Telegram subject and verification timestamp to a service-role-only Supabase RPC; do not store the raw phone or Telegram access token;
- preserve email verification, active `organizer_member`, eight-digit minimum, global FREE-claim uniqueness and organizer account limit in `create_organizer()`.

The exact callback to register with BotFather is:
`https://auth.sykabelajar.my.id/phone-verification/telegram/callback`.

Stage 3 hosted pgTAP phone/organizer compatibility fixture passed **26/26 assertions**. The fixture verifies service-role-only execution, provider subject uniqueness, phone-hash projection, trusted email and phone requirements, role requirement, one FREE identity claim, no second organizer workspace/claim, and denial of client-forged verification.

**Activation gates still outstanding:** the owner must create/register the Telegram bot OIDC application in BotFather, add the exact allowed callback URL, and provision its Client ID/Secret as Cloudflare Worker secrets. Keep the feature disabled until those steps and a real-device hosted acceptance test succeed. Telegram must not be added to the social-login priority list. No SMS/WhatsApp vendor or paid provider is introduced.

Reference: https://core.telegram.org/bots/telegram-login

### Read-only policy/trigger/function revalidation — 7 November 2026 (detailed breakdown)

A fresh catalog-only query of production `pg_policies` confirms the same **109 RLS policies across 61 tables**:

| Schema | Policies with `auth.uid()` in either expression |
|---|---:|
| `public` | 108 |
| `private` | 1 |
| **Total** | **109** |

Breakdown by expression location (these categories are mutually exclusive):

| Expression pattern | Policy count |
|---|---:|
| `USING` only | 67 |
| `WITH CHECK` only | 19 |
| Both `USING` and `WITH CHECK` | 23 |
| **Total** | **109** |

The direct expression set contains no `auth.jwt()` checks and no policy that directly names `auth.users`; the identity dependency is the UUID resolved by `auth.uid()`. Do not bulk-edit these policies. The migration contract must preserve UUID `sub` → `auth.uid()`, exact issuer validation, and PostgreSQL `role=authenticated`; test policy patterns by ownership, role, operation and table relationship.

The same read-only revalidation found exactly **3 non-internal triggers on `auth.users`**: `on_auth_user_created`, `trg_referral_email_confirmed`, and `trg_referral_signup_attribution`. It found **4 non-internal triggers on `public.profiles`**: account-type backend guard, currency backend guard, field normalization, and `updated_at`. All seven were enabled (`tgenabled='O'`). These are not to be disabled during overlap; the Better Auth provisioning path must coexist until a deliberate cutover.

The direct dependency query re-confirmed **8 function bodies that explicitly name `auth.users`** and **2 trigger functions that consume the `auth.users` row through `NEW`/`OLD` rather than querying the table by name**. Together with `create_organizer()`'s verified-phone fields, the existing ten-function inventory remains correct. The read-only function metadata check also confirmed all ten are SECURITY DEFINER; the functions' per-function `search_path` settings differ and must be preserved/reviewed individually.

One important test-planning detail: `public.register_for_competition(...)` is part of the identity migration surface because its optional referral flow reads the referrer's `email_confirmed_at`. It must be tested against the real restored schema and retain referral/self-referral checks, competition registration behavior, audit/notification side effects, and its existing output contract. Do not omit it merely because only `create_organizer()` blocks on verified phone.

These checks selected catalog definitions and policy expressions only. No user rows, account data, credentials, trigger state, policy, function, grant, or production schema object was modified.

## Full-schema Stage 3 acceptance checkpoint — 8 November 2026

The latest successful baseline run [#42469223582](https://github.com/taufx98/sykabelajar4.0/actions/runs/42469223582) executed, in order, the schema-only production export, local disposable restore, restored-schema zero-user checks, exact 69-FK catalog comparison, function/trigger/RLS/profile metadata parity, the reviewed identity-root draft, bounded 69-FK expansion/validation/cutover simulation, the production-shaped Better Auth provisioning/referral/email/phone/organizer regression, issuer-guard acceptance, and FK-only plus full Stage 3 rollback simulations. Every listed step completed successfully. The runner cleaned up the dump and disposable project; no schema artifact or user data was retained.

This clears the earlier “no full schema restore” prerequisite for further Stage 4/5 branch development. It does not authorize production migration. `private.app_users` remains absent in production; all 69 FKs still target `auth.users`, the three legacy Auth triggers remain, and the 109 existing `auth.uid()` policies remain unchanged. Remaining focused coverage includes the legacy referral read RPC output contract, profile-trigger parity, and any trigger overlap that is still reachable before cutover. Real hosted Telegram consent/callback, full Storage/Realtime/Edge integration, demo-user classification, merge-base reconciliation, owner approval and rollback sign-off remain separate gates.

### Referral read-RPC security checkpoint — 9 November 2026

The branch's production-shaped Stage 3 draft retains the existing `get_my_referrals()` (8 columns), `get_my_referrals_v2()` (9 columns), and `get_my_verified_referrals()` (5 columns) response shapes. All three return a typed `NULL::timestamptz` as `last_login_at`, use `SET search_path TO ''`, and explicitly revoke `PUBLIC`, `anon`, `authenticated`, and `service_role` before granting only `authenticated`. The latest disposable SQL regression verifies a real synthetic referral row through each RPC, the expected reward/status/activity/username fields, a NULL last-login field, referrer scoping, and denied anonymous/service-role execution. This has not been applied to production.

### 9 November 2026 — referral RPC and full-schema acceptance

The 9 November branch adds exact output/ACL acceptance for the three referral read RPCs. The result-column contracts are held at 8/9/5 fields respectively; `last_login_at` is `NULL::timestamptz` rather than a mirror of `auth.users.last_sign_in_at`. The functions use an empty `search_path`, revoke EXECUTE from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only `authenticated`. The disposable SQL regression verifies referrer row scope, expected username/status/reward/activity fields, NULL last-login values, and anonymous/service-role denial. It was applied only to the temporary schema-only restore in [baseline run #42509768714](https://github.com/taufx98/sykabelajar4.0/actions/runs/42509768714); no production grant/function was changed.

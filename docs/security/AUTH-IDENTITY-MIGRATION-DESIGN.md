# Better Auth identity-root migration design

Status: design proposal with a tested, opt-in Worker provisioning scaffold — not an executable production migration
Snapshot date: 6 November 2026

This document converts the current production catalog inventory into a proposed Stage 3 implementation. It does not authorize a production migration. The SQL tested is the synthetic fixture under `services/auth-worker/supabase-test/`; the proposed production PostgREST wrapper contract is recorded separately in [AUTH-STAGE-3-POSTGREST-RPC-WRAPPERS.sql](AUTH-STAGE-3-POSTGREST-RPC-WRAPPERS.sql). That wrapper file is documentation/draft only, not a migration applied to production.

## New-account-only migration model

Existing Supabase Auth identities are demo/testing accounts. The approved direction is **fresh Better Auth accounts only**: do not import old password hashes, credentials, OAuth tokens, sessions, or legacy login state; do not build a JIT password bridge or a password-reset campaign for demo users. New accounts receive a fresh Better Auth UUID, which is also used as Supabase `private.app_users.id` and JWT `sub`.

The demo-account cleanup and linked test-data scope belong to Stage 6. Until then, do not delete old Auth identities or dependent application records. If the 69-FK move happens before cleanup, preserve referenced old UUIDs in `private.app_users` as identity-only references where needed to keep current application relationships valid. They are not imported as Better Auth login accounts.

See [AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md](AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md) for the approved new-registration, identity and role rules. The superseded credential proposal is retained only as a decision record in [AUTH-LEGACY-CREDENTIAL-MIGRATION.md](AUTH-LEGACY-CREDENTIAL-MIGRATION.md).

## 1. Target responsibility split

| System | Owns |
|---|---|
| Better Auth + Cloudflare D1 | Password hashes, OAuth accounts, authentication sessions, email verification tokens, password reset tokens, OIDC authorization grants, and the primary user account record |
| Supabase private.app_users | Minimal, trusted identity projection needed by application SQL and FK integrity; it is not a credential store |
| Supabase public.profiles | Public/private application profile and education/profile fields |
| Supabase public.user_roles and business tables | Application permissions and business roles such as student, teacher, organizer member and admin; existing enum/table must be preserved |
| Better Auth-issued access JWT | UUID sub, PostgreSQL role=authenticated, trusted iss, aud, iat, exp, and ES256 kid; no business-role claim |

Do not create Better Auth shadow accounts in auth.users. Supabase Auth may remain enabled internally because Supabase currently cannot disable the Auth service; after cutover, stop using its signup/providers for application login, not assume the service can be switched off.

## 2. Proposed private.app_users projection

The initial table should contain only fields that application-side SQL demonstrably needs:

| Column | Type | Why it exists | Trusted writer |
|---|---|---|---|
| id | uuid primary key | Same UUID as Better Auth user ID and JWT sub; parent for application identity FKs | Provisioning RPC/Worker |
| email_verified_at | timestamptz null | Required by referral qualification and verified-email gates | Better Auth email-verification event for new accounts only |
| phone_verified_at | timestamptz null | Preserves the verified-phone requirement in organizer creation | A trusted Worker callback after Telegram OIDC consent and ID-token validation; remains NULL while the optional flow is disabled or no verified consent has completed |
| verified_phone_identity_hash | text null | Allows organizer eligibility/one-free-organizer-per-phone checks without storing a second raw phone number in Postgres | Server-only provisioning/phone-verification handler |
| created_at | timestamptz not null | Identity-root creation audit | Database default |
| updated_at | timestamptz not null | Projection update audit | Database / trusted writer |

The compatibility hash is now fixed: normalize the verified international Telegram phone claim to digits and calculate lowercase SHA-256, matching the legacy organizer identity contract. The Worker computes it only after validating Telegram's signed OIDC ID token; the browser never supplies the trusted phone/hash. The existing `private.organizer_free_identity_claims` records remain authoritative and no re-key or production data update is planned.

Do not add password, encrypted_password, session identifiers, OAuth credentials, bearer tokens, reset tokens, raw raw_user_meta_data, or business roles to private.app_users. Email/password and OAuth account credentials belong in D1. Current profiles already contains application profile information, including whatsapp; that field is not proof of phone verification.

last_sign_in_at is not needed by the current frontend referral UI: ReferralProgramPanel calls get_my_referrals_v2 but does not read last_login_at. Avoid adding a sign-in write on every login just to mirror this unused value. A temporary NULL response field may preserve the RPC shape until the API contract is reviewed.

## 3. Trusted identity provisioning

A single server-only, idempotent provisioning operation must create the application identity and its initial application records.

1. Better Auth creates the D1 user with a UUID ID.
2. The Worker calls a protected Supabase provisioning endpoint/RPC using server-held credentials. No service-role key or provisioning secret is placed in the browser.
3. Within one PostgreSQL transaction, provisioning inserts the `private.app_users` row, creates `public.profiles`, assigns only the allowed initial basic role in `public.user_roles`, and creates `public.user_settings`. Its server-only contract accepts an optional `p_email_verified` boolean (default false): true is permitted only when the Worker reads Better Auth's verified user state after a trusted provider check; email/password registration starts false.
4. Treat D1 and Supabase as two independent stores: there is no cross-database transaction. A successful D1 user insert is not proof that the Supabase projection succeeded. Provisioning must be idempotent, retryable, and observable.
5. Call provisioning after Better Auth user creation, and enforce a fail-closed gate in Better Auth's `session.create.before` hook: re-check/retry the Supabase projection for the session's user and return `false` (no session) until it is present and valid. This prevents an account with a failed initial projection from receiving an application session. The after hook is a fast path, not the only recovery path.
6. For Google/OAuth sign-up, the Worker may pass a verified-email indicator only when Better Auth's server-side user record reports `emailVerified = true` after the provider's verified-email check. For email/password sign-up, the initial value must be false. The synthetic contract covers this initial verified-provider case. Do not accept an email-verification flag from browser input.
7. For a later email/password verification, use Better Auth's `afterEmailVerification` callback to invoke the trusted Supabase verification operation. Before issuing a later session, reconcile the verified state from Better Auth if a previous callback failed; Supabase must not permanently remain unverified after a successful Better Auth verification.
8. Retry behavior must be safe: a duplicate request for the same UUID returns the already-provisioned identity and must not reset an existing profile, revoke role changes, overwrite user-edited fields, or reactivate disabled roles.
9. Preserve the live `public.app_role` enum and `public.user_roles` table. The current live enum contains `student`, `teacher`, `organizer_member`, and `admin`; do not drop, replace, or narrow it. Only these account types may be selected at public self-registration: student, teacher, and organizer. The server-side mapping is student → student, teacher → teacher, and organizer → organizer_member. Never accept admin, super_admin, organizer workspace ownership, or arbitrary role names from user metadata. Privileged role grants remain protected.
10. Organizer workspace creation remains a separate protected `create_organizer` operation after role, verification and uniqueness checks.

The old `handle_new_auth_user()` belongs to the current Supabase Auth registration path and is not the provisioning mechanism for new Better Auth users. The branch now contains an opt-in Worker implementation: Better Auth's `user.create.after` hook attempts the trusted RPC, `session.create.before` retries it and throws a fail-closed error until the Postgres identity is confirmed, and `afterEmailVerification` reconciles verified email state and referrals. The code requires `SUPABASE_PROVISIONING_ENABLED=true` plus a server-only `SUPABASE_SERVICE_ROLE_KEY`; the flag is absent/false by default, so the live staging Worker remains in auth-only mode. The hooks are locally type-checked and unit-tested but have not been enabled against any hosted Supabase project.

## 4. Referral and email-verification lifecycle

There are three existing Auth trigger/function paths and the replacement must be coordinated:

- Signup attribution currently reads raw_user_meta_data.referral_id, only accepts a UUID referrer different from the new user, requires an active referral program and a referrer whose email is confirmed, then inserts a unique PENDING referral.
- Referral qualification currently requires a qualifying activity in the first 24 hours, waits for the referred user's email verification, locks the pending event, changes it to VERIFIED, inserts an idempotent edu_coin_ledger entry, then credits the referrer.
- The email-confirmation trigger checks for a pending verified activity and invokes qualification after the email-confirmed timestamp changes from NULL to non-NULL.

Replacement behavior:

1. Resolve a referral code/ID server-side; do not trust a browser-provided referrer_user_id.
2. Validate the referrer identity and active reward settings before creating referral_events.
3. On Better Auth email verification, the Worker's `afterEmailVerification` callback calls a server-only idempotent event that writes `email_verified_at` in `private.app_users`. If the callback fails after Better Auth has marked the account verified, the next session-create gate must reconcile that state before allowing a session.
4. Re-run pending referral qualification for that user, preserving the 24-hour limits, earliest eligible activity, row locking, status transitions, reward amount snapshot, unique ledger key, and credit_profile_currency idempotency.
5. Rewrite verify_pending_referrals() to join private.app_users, not auth.users.
6. The new registration flow is Better Auth only after Stage 4/7 cutover. Do not create new application accounts through the old Supabase Auth signup path after cutover; existing demo identities are handled in Stage 6, not migrated as credentials.

The current active frontend referral caller does not use the legacy login-time field, so the new authentication flow should not add sign-in synchronization as a side effect.

## 5. Phone verification is a hard compatibility gate

The production public.create_organizer(text,text) function currently:

- requires auth.uid() and an active organizer_member role;
- requires a matching auth.users row;
- requires both email_confirmed_at and phone_confirmed_at;
- normalizes the confirmed phone to digits and requires at least eight digits;
- derives an identity hash and rejects a second free organizer claim for the same identity;
- creates the organizer, owner membership, free plan, access code and identity claim.

A trusted no-cost candidate is now implemented in the Better Auth Worker using Telegram's official OIDC `phone` scope. This is a phone-verification operation for a user who already has a Better Auth session; Telegram is not added to the SYKABELAJAR login-provider list. The Worker requests Authorization Code + PKCE S256, binds state/nonce/verifier to the Better Auth UUID, atomically rate-limits challenge creation, consumes each challenge once, and validates the signed ID token through Telegram JWKS with the exact issuer, Bot ID audience, nonce, expiry/freshness and `phone_number_verified=true` claim.

Only the digits-only SHA-256 identity hash, Telegram provider subject and trusted timestamp are projected to Supabase through the service-role-only RPC. Raw phone data and Telegram tokens are not persisted. The isolated SQL fixture preserves verified-email, active `organizer_member`, and one-FREE-organizer-per-phone rules and rejects client-forged verification. The design and synthetic SQL/Worker test gate are complete. Remote D1 migration 0005 is applied and the Telegram-capable Worker is deployed on isolated staging. The operational gate remains: BotFather app registration/callback allowlisting, Cloudflare Telegram Client ID/Secret, and a real hosted consent/callback acceptance test. Keep the feature disabled until those owner-controlled gates pass. Never substitute profile WhatsApp data, a browser-supplied phone/hash, or email-only verification.

## 6. Foreign-key migration sequence

Production currently has 69 validated, non-deferrable FKs across 62 application tables pointing to auth.users(id). Their exact names, source columns and delete actions are documented in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). The distribution is 42 CASCADE, 18 SET NULL, 8 NO ACTION, and 1 RESTRICT; all use MATCH SIMPLE and ON UPDATE NO ACTION. All source/target columns are UUID, and all 18 SET NULL source columns are nullable.

The eventual migration must:

1. Create private.app_users with id as a UUID primary key and no public API exposure.
2. Backfill identity-only UUID references required by the existing application FK graph before cleanup. For old demo UUIDs, preserve only what is needed to maintain dependent business-row integrity until Stage 6 cleanup; do not import credentials, tokens, sessions, or old login state. New Better Auth registrations write their fresh UUID to the identity root.
3. Check that there are zero child references without a corresponding identity-root row. Do not delete, null, or invent application rows to make the check pass.
4. For each of the 69 relationships, add a replacement FK to private.app_users(id) with the exact source column, original MATCH, ON UPDATE, ON DELETE, deferrability and validation state.
5. Validate the replacement constraints and prove row counts/integrity are unchanged.
6. Drop the old auth.users constraint only after its replacement is valid, then rename the replacement constraint to the original name.
7. Keep the existing profile, Edu Coin, order, competition and audit rows intact. In particular, the 18 SET NULL relationships must not be changed into cascades.
8. Re-run the orphan checks and catalog comparison; the new identity root must have the same UUID parent relation for all application references.

The current synthetic local test verifies the metadata-reconstruction idea and delete behavior for the four FK actions. The exact production mapping is recorded in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). A no-data schema export helper and automated GitHub Actions workflow are available in [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md). The workflow is ready but awaits the repository Actions secret `SUPABASE_DB_URL`; it will perform the export and disposable restore without owner CLI work once that secret is configured. The fixture test is not the actual 69-FK migration, and it does not replace full-schema tests or a migration review.

### Live catalog and review-only FK plan generator

A fresh read-only catalog query against production on 4 November 2026 confirmed the same 69 constraints and action distribution. A second full comparison against the committed snapshot found 69/69 identical records, zero added or removed constraints, and zero column/semantics drift. The sanitized catalog snapshot is committed at [live-auth-users-fk-catalog.json](../../scripts/auth-migration/live-auth-users-fk-catalog.json); it contains table/column/constraint metadata only, no user rows or UUIDs.

The plan generator at [generate-app-users-fk-plan.mjs](../../scripts/auth-migration/generate-app-users-fk-plan.mjs) validates the snapshot and emits three SQL files outside the repository:

```sh
node scripts/auth-migration/generate-app-users-fk-plan.mjs \\
  --catalog scripts/auth-migration/live-auth-users-fk-catalog.json \\
  --out-dir /tmp/sykabelajar-auth-fk-plan
```

- `01-preflight-expand.sql`: verifies the identity root contains every legacy Auth UUID, checks for orphaned child references, verifies the live FK catalog still matches the snapshot, and adds the 69 replacement constraints as `NOT VALID`.
- `02-validate.sql`: validates each replacement constraint.
- `03-cutover.sql`: checks that replacement constraints are validated and retain the expected semantics, then drops the old `auth.users` constraints and renames replacements to the original names.

This is a **SQL generator only**. It has no database connection and never executes SQL. Its output is not yet an approved migration: it assumes `private.app_users` has already been created and backfilled, and must not be run until the complete local schema baseline, issuer/phone-verification gates, hosted OIDC acceptance and rollback review are complete. The CI contract checks all 69 entries, all four delete actions, catalog drift guards, the three phase outputs, and absence of application DML in generated SQL.


## 7. RLS and issuer separation

Do not mass-rewrite the 109 policies and 188 functions that use auth.uid(). With a UUID sub, auth.uid() should continue to resolve the application identity. The local fixture proves the base Postgres JWT claim mapping and a two-user ownership policy only.

Before adding a Custom OIDC issuer to Supabase, validate the hosted integration in a separate Free project. During an explicitly planned overlap period, restrictive issuer checks must allow only the intended old Supabase Auth issuer and the Better Auth issuer; after cutover, remove the old issuer from the application policy allowlist. Never rely only on UUID matching if two issuers can be trusted.

Supabase's Custom OIDC integration requires an HTTPS issuer with discovery/JWKS, asymmetric signing, kid, and a JWT role claim set to authenticated. Supabase's current Free plan includes 50,000 Third-Party MAUs; stay within this allowance and do not enable paid overage or upgrade.

## Business-role preservation\n\nA live read-only production catalog check confirmed `public.app_role` currently contains `student`, `teacher`, `organizer_member`, and `admin`, and `public.user_roles` remains the business-role authority. Keep all existing role values, role records, admin guards, and role-based RPC/RLS behavior. Do not place business roles in the JWT: its `role` claim remains only `authenticated`. Public signup can provision only `student`, `teacher`, or `organizer_member`; admin is never self-assignable. The first admin bootstrap belongs to Stage 6 and must be protected and auditable.\n\n## Local contract-test evidence

The synthetic fixtures are exercised by [Supabase Local Auth Claims CI #41860723261](https://github.com/taufx98/sykabelajar4.0/actions/runs/41860723261), which passed **73/73 pgTAP assertions across three files** on 5 November 2026:

- 8 JWT/RLS assertions for UUID `sub` → `auth.uid()`, owner/cross-user boundaries, and the invariant that JWT `role` is PostgreSQL `authenticated`.
- 12 FK rehome assertions for UUID backfill, FK target replacement, and preservation of all four delete actions.
- 53 provisioning/referral assertions for server-only execution, preservation of the business-role enum/table, permitted basic-role mapping, rejection of admin self-registration, retry safety, no `auth.users` shadow row, trusted email verification, referral qualification and idempotent Edu Coin rewards.

The provisioning/referral fixture now has 68 assertions, including wrapper grants and service-role calls through the PostgREST wrapper, profile bootstrap projection for date of birth/institution/education level/favorite categories, role mapping, idempotency, rollback, trusted email verification, referral qualification and Edu Coin ledger cases. Across the three local SQL test files, Supabase Local Auth Claims CI [#42257123937](https://github.com/taufx98/sykabelajar4.0/actions/runs/42257123937) passed **88/88 pgTAP assertions**. The corresponding Worker hooks and transient D1 profile-bootstrap cleanup are implemented on the branch and covered by Worker integration/unit tests, but remain disabled until an isolated hosted Supabase project accepts Custom OIDC and the reviewed identity projection is installed there.

These tests verify the proposed SQL contract in an isolated synthetic schema. They do **not** prove the live application schema can be rebuilt from scratch, the real Better Auth Worker can reach Supabase securely, hosted Custom OIDC is accepted, every production RLS policy behaves correctly, or the production migration is safe to execute. All Stage 3 exit criteria below therefore remain mandatory.

## 8. Stage 3 exit criteria

Do not call Stage 3 complete until all are true:

- [ ] A reviewed, reproducible schema-only local baseline or complete synthetic integration fixture covers every table/constraint/function touched by the migration.
- [x] A trusted no-cost phone-verification design is selected and implemented as an opt-in Telegram OIDC `phone` flow with synthetic SQL/Worker coverage; remote D1 migration 0005 is applied and the Worker route is deployed to staging. Real BotFather credentials, callback allowlisting and hosted consent/callback acceptance remain separate activation gates.
- [x] Staging provisioning is server-only, transactional, idempotent and cannot grant privileged business roles; rollback-only staging RPC acceptance verified organizer→`organizer_member`, email/phone idempotency and duplicate Telegram-subject rejection. Production projection remains gated on the complete baseline.
- [ ] Referral attribution, email-verification lifecycle, 24-hour qualification and Edu Coin idempotency tests pass.
- [ ] All 69 FKs are rehomed with exact delete/update semantics and zero orphan records.
- [ ] The full set of affected RLS policies and RPCs pass cross-user, anonymous, student/teacher/organizer/admin, and both trusted-issuer test cases.
- [ ] Edge Function identity checks and caller ownership checks remain correct with Better Auth JWTs.
- [x] Hosted Supabase Custom OIDC core acceptance is complete on the isolated Free project; Storage/Realtime/Edge-token positive acceptance remains a separate Stage 2 surface gate.
- [ ] A rollback procedure is reviewed before any production schema change.

## 9. Current safety boundary

A read-only production catalog revalidation on 5 November 2026 reconfirmed all 69 application foreign keys against the committed snapshot: zero additions, removals, or semantic changes. The 10 additional foreign keys in the `auth` schema are Supabase-internal and are deliberately excluded from the application FK migration. The 69 application FKs retain 42 CASCADE, 18 SET NULL, 8 NO ACTION, and 1 RESTRICT actions.

No DDL or DML migration has been executed against the production project. No account was deleted, no auth.users row was created for Better Auth, no production trigger/function was replaced, and no live Edge Function was deployed. This remains a design and test proposal, not a production migration.

## Stage 5 Edge Function identity adapter — current implementation guidance (6 November 2026)

The production Edge Function source audit shows four active user-facing functions still calling `supabase.auth.getUser()`: `get-cloudinary-signature`, `payment-gateway-create`, `payment-gateway-reconcile`, and `payment-gateway-admin`. Do not assume the Better Auth UUID has a corresponding row in `auth.users`; that assumption is explicitly removed by the migration architecture.

For a user-invoked Edge Function, evaluate Supabase's current `@supabase/server` wrapper with `withSupabase({ auth: 'user' })`, keeping platform `verify_jwt = true`. The wrapper provides verified `userClaims` / `jwtClaims` and a user-RLS-scoped Supabase client. A function needing privileged operations may still use its server-only admin client, but it must derive the caller UUID from verified claims and preserve owner, business-role and issuer checks before every privileged operation. Do not decode bearer tokens without signature validation, do not trust user metadata as authorization, and do not switch a user endpoint to `auth: 'none'` to bypass the old verifier.

Signed provider callbacks remain separate: `payment-webhook` and `payment-gateway-webhook` have `verify_jwt = false` and must continue to verify their provider signature, timestamp and event idempotency. They must not be converted into user-JWT endpoints.

All nine identity/ownership-sensitive user-facing Edge Function implementations (six Cloudinary and three payment), the legacy Midtrans delegate, and the separate provider webhook/public certificate handlers must be covered by the appropriate two-user hosted IDOR, provider-signature, and public-visibility matrices before Stage 5 is complete. Current Supabase reference: https://supabase.com/docs/guides/functions/auth.


## Stage 5 implementation scaffold checkpoint — 6 November 2026

The repo now contains a non-deployed shared Edge Function adapter at `supabase/functions/_shared/better-auth-user.ts`, backed by pure claim validation at `auth-claims.mjs`. It pins `npm:@supabase/server@1.9.2`, calls `createSupabaseContext(request, { auth: "user" })`, then enforces exact configured issuer/audience, UUID subject and matching `userClaims.id`, Postgres `role=authenticated`, integer token times and a maximum 300-second lifetime. It does not decode JWTs or implement cryptographic verification manually.

A contract suite now tests valid/invalid claims, wrong issuer/audience, non-UUID subjects, business-role misuse, expiry/time/lifetime errors, platform JWT settings, and webhook signature boundaries. `supabase/config.toml` now explicitly sets `verify_jwt=true` for `payment-gateway-reconcile`, in addition to the other user-invoked payment/Cloudinary endpoints. Payment-provider webhooks remain `verify_jwt=false` and retain their independent signature verification.

This adapter has **not** been wired into the four live user-facing Edge Function implementations, and no Edge Function was deployed. Do not deploy the adapter until Stage 2 Custom OIDC acceptance and Stage 3 identity projection are proven in an isolated Supabase project. See [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md).


## Registration schema compatibility check — 6 November 2026

A fresh read-only catalog check confirms `public.profiles.account_type` is `text NOT NULL DEFAULT 'student'` with `profiles_account_type_check` allowing exactly `student`, `teacher`, and `organizer`. The existing business role enum remains `student`, `teacher`, `organizer_member`, and `admin`. The existing profile table also has a unique index on `username`, but no database username format/length check. The Better Auth mapping remains student → student, teacher → teacher, organizer → organizer_member; admin is never a self-registration type.

The current registration frontend maps `pelajar/guru/penyelenggara` using `uiRoleToAccountType()` but only trims spaces/lowers case for username; it does not yet mirror the Worker validator. Stage 4 should add matching client-side validation without treating it as authorization. A metadata-only aggregate of the current 11 profile usernames found all 11 fit the new safe-segment rule (3–40, lower-case alphanumeric/dot/underscore/hyphen); no username values were selected. This is a compatibility snapshot only, not proof that future frontend input validation already exists.


## Latest profile-bootstrap and seven-column deployment-gate checkpoint — 6 November 2026

The latest branch source remains isolated and unmerged. The Stage 3 signup projection now carries the existing registration form's full profile payload into PostgreSQL: `birthDate → profiles.birth_date`, `institution → profiles.institution`, `grade → profiles.grade`, `subjects → profiles.subjects`, along with `username`, `accountType`, and optional `referralCode`. The private/public provisioning RPC fixture preserves positional compatibility by appending optional profile arguments after the existing arguments. The SQL fixture proves all four fields are projected through the public PostgREST wrapper as `service_role`; the run passed 88/88 pgTAP assertions.

The Worker validates the profile bootstrap values before the D1 user row is inserted. Profile/referral bootstrap fields are marked non-returned by Better Auth and are cleared from D1 only after the Postgres projection succeeds. If the Postgres call or D1 cleanup fails, session creation fails closed and the registration payload remains available for retry. `accountType` and `username` remain in D1 as stable mapping metadata; business role authorization remains in `public.user_roles`, not Better Auth user metadata or JWT role claims.

The immutable Better Auth baseline generator now strips all seven custom fields from regenerated `0001_better_auth.sql`; additive migration `0004_better_auth_registration_attributes.sql` is the single source of those columns. The migration, staging deploy, and local Worker CI workflows now each require all seven columns: `accountType`, `username`, `referralCode`, `birthDate`, `institution`, `grade`, and `subjects`. Static workflow-contract tests lock this seven-column gate.

Verified CI:
- [Auth Worker CI #42258287868](https://github.com/taufx98/sykabelajar4.0/actions/runs/42258287868) — **success** on commit `c659a2ffe6674a974b542246acdd0347e9c3d09f`; Worker audit/typecheck/build, 60 Worker tests, 12 JWT tests, 15 Cloudinary ownership tests, two frontend inventory tests, signup/email-verification/session/OIDC integration, and frontend lint/typecheck/build all passed.
- [Supabase Local Auth Claims CI #42257123937](https://github.com/taufx98/sykabelajar4.0/actions/runs/42257123937) — **success**; local disposable Supabase and Deno type-check passed, with 88/88 pgTAP assertions.
- [Cloudflare staging read-only preflight #42258255042](https://github.com/taufx98/sykabelajar4.0/actions/runs/42258255042) — **success**. It does not deploy or migrate remote resources.

**Historical Stage 1/2 snapshot from before the 7 November 2026 staging work; superseded by the current roadmap/status files.** Remote D1 migrations 0000–0006 are now applied and the provider-aware/Telegram-capable Worker is deployed on isolated staging. Core hosted OIDC and two-user RLS acceptance have passed; Storage/Realtime policy semantics and the Edge probe have additional staging-only coverage. Remaining owner gates are Brevo Free sender/API Key and BotFather OIDC credentials/hosted callback. Production baseline and identity/FK/RLS migration remain incomplete. No production database, Edge Function, secret, Cloudinary asset, or application login flow was changed.


## 6.1 Foreign-key lock and cutover plan — 7 November 2026

The 69-FK generator is a **review-only plan**, not a production execution script. It now groups `ADD CONSTRAINT ... NOT VALID` and `VALIDATE CONSTRAINT` work into bounded transactions per source table (62 source tables), while retaining full-catalog preflight checks and one globally atomic final cutover. This reduces lock retention across the child-table graph without allowing a mixed old/new FK reference state during cutover.

PostgreSQL 17 documents the following behavior ([ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)):

- `ADD FOREIGN KEY ... NOT VALID` takes `SHARE ROW EXCLUSIVE` locks on both the referencing table and the referenced table. `NOT VALID` skips the initial historical-row scan, but the new FK is enforced for subsequent inserts and updates.
- `VALIDATE CONSTRAINT` scans existing rows, takes `SHARE UPDATE EXCLUSIVE` on the referencing table, and for an FK also takes `ROW SHARE` on the referenced table.
- `ALTER TABLE` takes `ACCESS EXCLUSIVE` by default unless a subcommand documents a weaker lock. The generated drop/rename cutover must therefore be treated as an exclusive-lock phase until confirmed against the exact PostgreSQL 17 commands and a staging rehearsal.

The current generator creates one expand transaction and one validation transaction per source table, each guarded by the configured `lock_timeout` and `statement_timeout`. Those locks are released after each source table commits. The cutover remains one transaction containing all 69 drop/rename pairs so no connection can observe an application graph where only some foreign keys reference `private.app_users`.

Required work before the generated plan can be approved:

1. [x] Revise the expand and validation output to use bounded per-source-table transactions while keeping preflight checks over the full 69-FK snapshot.
2. [x] Add safe resume/reconciliation: an exact already-present replacement constraint is recognized and left in place; missing or semantically different constraints fail closed. Validate phase checks whether each replacement exists and is validated before deciding to validate it again. Never blindly rerun a phase after manual partial changes.
3. [x] Keep cutover globally atomic; all 69 legacy constraints are guarded for exact semantics, all 69 replacement constraints must be present/validated, then the drop/rename batch commits once.
4. Prepare a production runbook with measured table sizes/row counts, a low-traffic maintenance window, bounded `lock_timeout` and `statement_timeout`, long-transaction checks, lock-wait monitoring, abort criteria, and post-commit catalog/orphan verification. Timeout values must be selected from actual workload measurements, not guessed.
5. Reconfirm the live FK catalog immediately before generating or executing any production plan. No DDL is authorized by this design note.

A read-only size snapshot of the 62 FK-referencing tables on 7 November 2026 found the largest measured relation (`public.system_error_events`) at approximately 352 KB and the next (`public.audit_logs`) at approximately 280 KB. These are catalog size measurements, not row exports or a guarantee about future data volume; planner row estimates may be stale. Re-measure immediately before any maintenance decision.

The generator is now bounded/resumable and covered by CI, but it remains review-only. Production execution is still blocked on the owner-local full schema-only baseline and a successful disposable restore, production-shaped regression across the ten Auth-dependent functions/three triggers/profiles/RLS policies, a fresh live 69-FK catalog re-capture, measured lock/timeout runbook and an explicit owner approval of the production DDL. No production FK was modified.


## Production compatibility findings from exact function/trigger definitions — 7 November 2026

The Stage 3 design was cross-checked against the live definitions of all ten Auth-dependent functions and the non-internal triggers on `auth.users` and `public.profiles`.

1. **Signup referral event:** the old `capture_signup_referral()` reads a UUID from `raw_user_meta_data.referral_id`, whereas the Better Auth provisioning contract currently accepts a referral code and resolves it through `public.referral_codes`. This is an intentional server-side mapping change, but it must be documented and tested for legacy UUID compatibility where needed. Competition registration currently accepts either a referral code or UUID string; resolve both on the server and validate the referrer against the trusted identity projection.
2. **Email-verification lifecycle:** the legacy trigger only runs on the Auth row's NULL → non-NULL confirmation transition. Better Auth does not write that Auth row. The Worker callback must be trusted, idempotent, and able to reconcile a verification event after a transient Postgres failure before session creation is allowed. The existing synthetic callback tests do not prove a full production trigger overlap.
3. **Referral activity:** production referral qualification is invoked from daily check-ins, comments, follows, and daily-task completion triggers. Its function also supports `chat` activity and the scheduled `verify_pending_referrals()` scans chat messages. Do not alter these activity rules in the authentication migration without a separately verified product/data-retention decision. The exact live trigger list is in the dependency inventory.
4. **Profile writes:** production `profiles` has 36 columns and four active triggers (normalization, account-type guard, currency guard, updated_at). New-user projection should populate only trusted registration fields and let existing defaults/triggers work. Retry must not overwrite user-edited profile fields or reactivate a disabled business role; this deliberately improves on the legacy Auth trigger's upsert behavior and must be covered by a production-shaped fixture.
5. **Cloudinary references:** avatar/cover public IDs, URLs, dimensions, versions and resource types live in profile metadata. Preserve those columns and all existing asset references. This migration does not move media into Supabase Storage.
6. **RPC ACLs:** the exact grants are documented in the dependency inventory. In particular, `get_my_verified_referrals()` has an existing anonymous EXECUTE grant despite its `auth.uid()` filter. Review its consumers and tighten only as a separately tested compatibility/security change; do not silently replicate that grant on a replacement function.
7. **Organizer phone identity:** the live `create_organizer()` requires authenticated `organizer_member`, verified email, verified phone timestamp and phone number, minimum eight normalized digits, and a SHA-256 identity hash unique in `private.organizer_free_identity_claims`. The Worker flow and migration 0005 are deployed/applied on isolated staging, but BotFather credentials and real hosted consent/callback acceptance remain open. Only the trusted verified-phone hash may be projected to `private.app_users`; neither `profiles.whatsapp` nor user-provided phone text is proof of verification. Production `create_organizer()` remains untouched.

The fixture remains a contract test for the new Better Auth callback/provisioning design, not a substitute for a restore of the live schema. No production functions, triggers, ACLs, or data were modified.


The currently active frontend caller of `get_my_referrals_v2()` is `ReferralProgramPanel.tsx`; it does not consume `last_login_at`. No active frontend caller for `get_my_verified_referrals()` was found in the branch. Live ACLs nevertheless show an anonymous EXECUTE grant on the latter RPC, which should be treated as a separate review candidate, not copied into the new function grants. A live read-only check of `cron.job` found no current job calling `verify_pending_referrals()`; any scheduling assumption must be verified rather than copied from a historical migration.


## Verified-phone compatibility design — Telegram OIDC candidate (7 November 2026)

The new Worker phone-verification flow uses Telegram's official OIDC Authorization Code flow with PKCE S256 and the `phone` scope. It does **not** add Telegram as an account sign-in method. The user is already authenticated to Better Auth and explicitly starts the phone-verification route; the Worker binds the challenge to the session's UUID and consumes the state once.

The callback validates the signed ID token against Telegram's RS256 JWKS, exact issuer and Bot ID audience, nonce, expiry and freshness. It requires `phone_number_verified=true`, normalizes the international number, then hashes the digits with SHA-256. Only the hash, provider subject, provider name and trusted verification timestamp are passed to the service-role-only Postgres wrapper. Raw phone, ID token and access token are not persisted.

The new `0005_telegram_phone_verification.sql` D1 migration stores only short-lived state/nonce/PKCE challenge material. It was applied to the exact isolated D1 by [run #42339140591](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339140591); the resulting 18-table schema and empty challenge state were verified before the Telegram-capable Worker deploy. This does not enable phone verification or change production.

The hosted synthetic SQL fixture and pgTAP test passed 26/26 assertions while preserving the `create_organizer()` gates and one-FREE-organizer uniqueness. The fixture uses a fixed empty search path for its SECURITY DEFINER organizer function and never grants clients direct access to phone-verification tables or functions.

This is a technically validated candidate, not an operationally enabled provider. BotFather registration, Cloudflare secrets, the remote staging D1 migration, and an actual hosted consent/callback test remain required before marking the verified-phone blocker closed. Production `create_organizer()` remains untouched.

## Current Stage 3 preparation checkpoint — 7 November 2026

- Remote staging D1 migrations 0000–0006 are applied, the provider-aware/Telegram-capable Worker is deployed, and isolated staging provisioning RPCs passed rollback-only tests. Production identity objects have not been changed.
- The complete production schema-only baseline is still owner-local: the exporter must be run from a trusted machine with the production database connection URI. A schema-only dump must then be restored to a disposable local Supabase stack, with custom Auth/Storage DDL, roles/grants, extensions and all dependencies reconciled before identity DDL can be tested.
- The FK generator now uses 62 bounded expand batches and 62 bounded validation batches (one per referencing table), with exact resume/reconciliation guards. The final drop/rename phase remains one globally atomic transaction. It generates SQL only and must never be run against production at this point.
- The latest staging social provider config supports optional Google, Facebook and X only when both Worker credentials exist; sessions remain blocked until SYKABELAJAR email verification. No provider credentials are installed. Instagram personal login remains unsupported by Meta.
- Current open activation/acceptance gates: Brevo sender-domain/API Key and admin-only email test; BotFather credentials and hosted phone consent/callback; positive Better Auth token calls for Storage API, Realtime WebSocket and staging Edge probe; full production-shaped 10-function/3-trigger/109-policy regression after baseline; explicit owner approval before any production DDL.
- No production schema, FK, trigger, RLS policy, Edge Function, Auth setting, user, credential or login route was changed.

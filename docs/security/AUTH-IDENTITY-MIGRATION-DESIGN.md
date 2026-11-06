# Better Auth identity-root migration design

Status: design proposal only — not an executable production migration
Snapshot date: 4 November 2026

This document converts the current production catalog inventory into a proposed Stage 3 implementation. It does not authorize a production migration. The only SQL currently tested is the synthetic fixture under services/auth-worker/supabase-test/.

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
| phone_verified_at | timestamptz null | Preserves the verified-phone requirement in organizer creation | A trusted phone-verification event; remains NULL until that flow exists |
| verified_phone_identity_hash | text null | Allows organizer eligibility/one-free-organizer-per-phone checks without storing a second raw phone number in Postgres | Server-only provisioning/phone-verification handler |
| created_at | timestamptz not null | Identity-root creation audit | Database default |
| updated_at | timestamptz not null | Projection update audit | Database / trusted writer |

The exact phone hash algorithm must be decided before implementing the new organizer RPC. Current create_organizer normalizes the verified phone to digits, requires at least eight digits, calculates SHA-256, and checks private.organizer_free_identity_claims. The replacement must remain compatible with the existing claim records or include a separately tested re-key plan. It must never trust a phone number or hash submitted directly by a browser.

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

The old `handle_new_auth_user()` belongs to the current Supabase Auth registration path and is not the provisioning mechanism for new Better Auth users. After cutover, the Better Auth Worker path must call the new trusted provisioning operation directly; it must not rely on a trigger on `auth.users` or create shadow Auth rows. Better Auth's database `user.create.after` hook is suitable for the first provisioning attempt, while `session.create.before` is the fail-closed retry gate; its supported behavior is to stop session creation when the hook returns `false`. Email/password verification must use Better Auth's `afterEmailVerification` callback. These hooks are a planned integration contract, not yet implemented in the Worker.

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

The Better Auth Worker proof of concept does not yet provide a trusted phone-verification mechanism. Do not replace this requirement with a profile whatsapp value, an unchecked user claim, or email-only verification.

No paid SMS/WhatsApp provider is approved under the free-only rule. Until a viable, trusted no-cost phone-verification path is established and tested, migration of create_organizer is blocked. Do not substitute profile WhatsApp data or an untrusted browser claim. Existing legacy phone-confirmation data may be consulted only during the explicitly approved overlap period, not copied as proof for newly created Better Auth users.

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

The current synthetic local test verifies the metadata-reconstruction idea and delete behavior for the four FK actions. The exact production mapping is recorded in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). A no-data schema export helper and runbook are available at [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md); the export still needs to be run on the owner's trusted machine. The fixture test is not the actual 69-FK migration, and it does not replace full-schema tests or a migration review.

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

The 53 provisioning/referral assertions include initial verified-email projection from a trusted Google identity (`p_email_verified = true`) and a fresh-UUID username-collision case proving the identity root and settings roll back together. These are synthetic SQL contract tests; the corresponding Worker provisioning hooks are still not implemented.

These tests verify the proposed SQL contract in an isolated synthetic schema. They do **not** prove the live application schema can be rebuilt from scratch, the real Better Auth Worker can reach Supabase securely, hosted Custom OIDC is accepted, every production RLS policy behaves correctly, or the production migration is safe to execute. All Stage 3 exit criteria below therefore remain mandatory.

## 8. Stage 3 exit criteria

Do not call Stage 3 complete until all are true:

- [ ] A reviewed, reproducible schema-only local baseline or complete synthetic integration fixture covers every table/constraint/function touched by the migration.
- [ ] A trusted phone-verification design is selected without violating the free-only constraint, or organizer creation is explicitly excluded from the migration with an approved compatibility plan.
- [ ] Provisioning is server-only, transactional, idempotent and cannot grant privileged business roles.
- [ ] Referral attribution, email-verification lifecycle, 24-hour qualification and Edu Coin idempotency tests pass.
- [ ] All 69 FKs are rehomed with exact delete/update semantics and zero orphan records.
- [ ] The full set of affected RLS policies and RPCs pass cross-user, anonymous, student/teacher/organizer/admin, and both trusted-issuer test cases.
- [ ] Edge Function identity checks and caller ownership checks remain correct with Better Auth JWTs.
- [ ] Hosted Supabase Custom OIDC is tested against an isolated Free project; do not use production as a staging substitute.
- [ ] A rollback procedure is reviewed before any production schema change.

## 9. Current safety boundary

A read-only production catalog revalidation on 5 November 2026 reconfirmed all 69 application foreign keys against the committed snapshot: zero additions, removals, or semantic changes. The 10 additional foreign keys in the `auth` schema are Supabase-internal and are deliberately excluded from the application FK migration. The 69 application FKs retain 42 CASCADE, 18 SET NULL, 8 NO ACTION, and 1 RESTRICT actions.

No DDL or DML migration has been executed against the production project. No account was deleted, no auth.users row was created for Better Auth, no production trigger/function was replaced, and no live Edge Function was deployed. This remains a design and test proposal, not a production migration.

## Stage 5 Edge Function identity adapter — current implementation guidance (6 November 2026)

The production Edge Function source audit shows four active user-facing functions still calling `supabase.auth.getUser()`: `get-cloudinary-signature`, `payment-gateway-create`, `payment-gateway-reconcile`, and `payment-gateway-admin`. Do not assume the Better Auth UUID has a corresponding row in `auth.users`; that assumption is explicitly removed by the migration architecture.

For a user-invoked Edge Function, evaluate Supabase's current `@supabase/server` wrapper with `withSupabase({ auth: 'user' })`, keeping platform `verify_jwt = true`. The wrapper provides verified `userClaims` / `jwtClaims` and a user-RLS-scoped Supabase client. A function needing privileged operations may still use its server-only admin client, but it must derive the caller UUID from verified claims and preserve owner, business-role and issuer checks before every privileged operation. Do not decode bearer tokens without signature validation, do not trust user metadata as authorization, and do not switch a user endpoint to `auth: 'none'` to bypass the old verifier.

Signed provider callbacks remain separate: `payment-webhook` and `payment-gateway-webhook` have `verify_jwt = false` and must continue to verify their provider signature, timestamp and event idempotency. They must not be converted into user-JWT endpoints.

The four user-facing functions, webhook handlers and their exact deployed versions must be covered by the two-user hosted IDOR/authorization matrix before Stage 5 is complete. Current Supabase reference: https://supabase.com/docs/guides/functions/auth.

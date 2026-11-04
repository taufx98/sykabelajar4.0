# Better Auth identity-root migration design

Status: design proposal only — not an executable production migration
Snapshot date: 4 November 2026

This document converts the current production catalog inventory into a proposed Stage 3 implementation. It does not authorize a production migration. The only SQL currently tested is the synthetic fixture under services/auth-worker/supabase-test/.

## 1. Target responsibility split

| System | Owns |
|---|---|
| Better Auth + Cloudflare D1 | Password hashes, OAuth accounts, authentication sessions, email verification tokens, password reset tokens, OIDC authorization grants, and the primary user account record |
| Supabase private.app_users | Minimal, trusted identity projection needed by application SQL and FK integrity; it is not a credential store |
| Supabase public.profiles | Public/private application profile and education/profile fields |
| Supabase public.user_roles and business tables | Application permissions and business roles such as student, teacher, organizer member and admin |
| Better Auth-issued access JWT | UUID sub, PostgreSQL role=authenticated, trusted iss, aud, iat, exp, and ES256 kid; no business-role claim |

Do not create Better Auth shadow accounts in auth.users. Supabase Auth may remain enabled internally because Supabase currently cannot disable the Auth service; after cutover, stop using its signup/providers for application login, not assume the service can be switched off.

## 2. Proposed private.app_users projection

The initial table should contain only fields that application-side SQL demonstrably needs:

| Column | Type | Why it exists | Trusted writer |
|---|---|---|---|
| id | uuid primary key | Same UUID as Better Auth user ID and JWT sub; parent for application identity FKs | Provisioning RPC/Worker |
| email_verified_at | timestamptz null | Required by referral qualification and verified-email gates | Better Auth verification event; legacy Auth sync only during transition |
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
3. Within one database transaction, provisioning inserts the private.app_users row, creates the public.profiles row, assigns only the allowed initial basic role in public.user_roles, and creates public.user_settings.
4. Retry behavior must be safe: a duplicate request for the same UUID returns the already-provisioned identity and must not reset an existing profile, revoke role changes, or overwrite user-edited fields.
5. Only these account types may be selected at self-registration: student, teacher, and organizer, consistent with the existing trigger. The mapping is student → student, teacher → teacher, and organizer → organizer_member. Never accept admin, super_admin, organizer workspace ownership, or arbitrary role names from user metadata.
6. Organizer workspace creation remains a separate protected create_organizer operation after role, verification and uniqueness checks.

The old handle_new_auth_user() currently upserts the profile from raw_user_meta_data, then provisions the basic role and settings. A transition version may create/update private.app_users before those records for legacy Supabase Auth registrations. The Better Auth Worker path must not rely on a trigger on auth.users.

## 4. Referral and email-verification lifecycle

There are three existing Auth trigger/function paths and the replacement must be coordinated:

- Signup attribution currently reads raw_user_meta_data.referral_id, only accepts a UUID referrer different from the new user, requires an active referral program and a referrer whose email is confirmed, then inserts a unique PENDING referral.
- Referral qualification currently requires a qualifying activity in the first 24 hours, waits for the referred user's email verification, locks the pending event, changes it to VERIFIED, inserts an idempotent edu_coin_ledger entry, then credits the referrer.
- The email-confirmation trigger checks for a pending verified activity and invokes qualification after the email-confirmed timestamp changes from NULL to non-NULL.

Replacement behavior:

1. Resolve a referral code/ID server-side; do not trust a browser-provided referrer_user_id.
2. Validate the referrer identity and active reward settings before creating referral_events.
3. On Better Auth email verification, call a server-only idempotent event that writes email_verified_at in private.app_users.
4. Re-run pending referral qualification for that user, preserving the 24-hour limits, earliest eligible activity, row locking, status transitions, reward amount snapshot, unique ledger key, and credit_profile_currency idempotency.
5. Rewrite verify_pending_referrals() to join private.app_users, not auth.users.
6. Keep legacy Auth signup/verification behavior working during any approved dual-issuer transition, until old signup is actually disabled at the cutover.

The current active frontend referral caller does not use the legacy login-time field, so the migration should not add sign-in synchronization as a side effect.

## 5. Phone verification is a hard compatibility gate

The production public.create_organizer(text,text) function currently:

- requires auth.uid() and an active organizer_member role;
- requires a matching auth.users row;
- requires both email_confirmed_at and phone_confirmed_at;
- normalizes the confirmed phone to digits and requires at least eight digits;
- derives an identity hash and rejects a second free organizer claim for the same identity;
- creates the organizer, owner membership, free plan, access code and identity claim.

The Better Auth Worker proof of concept does not yet provide a trusted phone-verification mechanism. Do not replace this requirement with a profile whatsapp value, an unchecked user claim, or email-only verification.

No paid SMS/WhatsApp provider is approved under the free-only rule. Until a viable, trusted no-cost phone-verification path is established and tested, migration of create_organizer is blocked. It may continue to use the legacy verification state during a transition, but there must be an explicit, reviewed compatibility plan before its auth.users read is removed.

## 6. Foreign-key migration sequence

Production currently has 69 validated, non-deferrable FKs across 62 application tables pointing to auth.users(id). Their exact names, source columns and delete actions are documented in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). The distribution is 42 CASCADE, 18 SET NULL, 8 NO ACTION, and 1 RESTRICT; all use MATCH SIMPLE and ON UPDATE NO ACTION. All source/target columns are UUID, and all 18 SET NULL source columns are nullable.

The eventual migration must:

1. Create private.app_users with id as a UUID primary key and no public API exposure.
2. Backfill the root with every existing user UUID needed by the application, including its trusted legacy verification projection. This is a metadata copy, not a copy of passwords or sessions.
3. Check that there are zero child references without a corresponding identity-root row. Do not delete, null, or invent application rows to make the check pass.
4. For each of the 69 relationships, add a replacement FK to private.app_users(id) with the exact source column, original MATCH, ON UPDATE, ON DELETE, deferrability and validation state.
5. Validate the replacement constraints and prove row counts/integrity are unchanged.
6. Drop the old auth.users constraint only after its replacement is valid, then rename the replacement constraint to the original name.
7. Keep the existing profile, Edu Coin, order, competition and audit rows intact. In particular, the 18 SET NULL relationships must not be changed into cascades.
8. Re-run the orphan checks and catalog comparison; the new identity root must have the same UUID parent relation for all application references.

The current synthetic local test verifies the metadata-reconstruction idea and delete behavior for the four FK actions. The exact production mapping is recorded in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md). A no-data schema export helper and runbook are available at [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md); the export still needs to be run on the owner's trusted machine. The fixture test is not the actual 69-FK migration, and it does not replace full-schema tests or a migration review.

## 7. RLS and issuer separation

Do not mass-rewrite the 109 policies and 188 functions that use auth.uid(). With a UUID sub, auth.uid() should continue to resolve the application identity. The local fixture proves the base Postgres JWT claim mapping and a two-user ownership policy only.

Before adding a Custom OIDC issuer to Supabase, validate the hosted integration in a separate Free project. During an explicitly planned overlap period, restrictive issuer checks must allow only the intended old Supabase Auth issuer and the Better Auth issuer; after cutover, remove the old issuer from the application policy allowlist. Never rely only on UUID matching if two issuers can be trusted.

Supabase's Custom OIDC integration requires an HTTPS issuer with discovery/JWKS, asymmetric signing, kid, and a JWT role claim set to authenticated. Supabase's current Free plan includes 50,000 Third-Party MAUs; stay within this allowance and do not enable paid overage or upgrade.

## Local contract-test evidence

The synthetic fixtures are now exercised by [Supabase Local Auth Claims CI #41776739736](https://github.com/taufx98/sykabelajar4.0/actions/runs/41776739736), which passed **68/68 pgTAP assertions across three files**:

- 7 JWT/RLS assertions for `auth.uid()` UUID mapping and owner/cross-user boundaries.
- 12 FK rehome assertions for UUID backfill, FK target replacement, and preservation of all four delete actions.
- 49 provisioning/referral assertions for service-role-only execution, permitted business-role mapping, rejection of admin self-registration, retry safety, no `auth.users` shadow row, trusted email verification, 24-hour referral qualification, and idempotent Edu Coin reward behavior.

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

No DDL or DML migration has been executed against the production project. No account was deleted, no auth.users row was created for Better Auth, no production trigger/function was replaced, and no live Edge Function was deployed. This is a design proposal to guide the next implementation step.
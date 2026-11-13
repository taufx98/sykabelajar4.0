# New Better Auth account and business-role contract

Status: approved implementation direction for the seven-stage migration.
Date: 4 November 2026

## Decision: fresh authentication accounts only

The existing Supabase Auth users are demo/testing identities. The migration will **not** import their passwords, bcrypt hashes, OAuth credentials, refresh tokens, or sessions into Better Auth. There will be no just-in-time password bridge and no legacy password reset campaign.

After cutover, all newly registered users will authenticate through Better Auth on Cloudflare Workers + D1. Better Auth generates a fresh UUID for each new account. That UUID becomes the immutable identity key used by:
- Better Auth `user.id` in D1;
- Supabase `private.app_users.id`;
- Supabase JWT `sub`, with Postgres `role=authenticated`.

The old demo/testing accounts are not migrated as login accounts. They are outside the Better Auth login migration and will remain untouched. Do not import, reset, delete, or clean up old Supabase Auth users or their related application data as part of this work.

## Preserve business roles — do not simplify or remove them

Supabase `public.user_roles` and the existing `public.app_role` enum remain the source of truth for SYKABELAJAR business permissions. A live read-only production catalog check on 4 November 2026 confirmed these enum values:

- `student`
- `teacher`
- `organizer_member`
- `admin`

The existing `user_roles` table and role enum must not be dropped, replaced with a generic role string, or moved into Better Auth. Preserve the schema, grants, RLS, admin checks, and business-role semantics. Any future enum additions must use a forward-only migration; never recreate the enum in a way that loses existing values.

The JWT claim `role=authenticated` is exclusively the PostgreSQL API role. It must never contain `admin`, `teacher`, `organizer_member`, or another SYKABELAJAR business role. Authorization continues to check the current active `public.user_roles` row and existing business authorization logic.

## Registration role policy

Public registration may select only the currently approved basic account types, mapped server-side:

| Registration account type | Stored profile type | Initial business role |
|---|---|---|
| `student` | `student` | `student` |
| `teacher` | `teacher` | `teacher` |
| `organizer` | `organizer` | `organizer_member` |

The mapping is enforced in the trusted database provisioning function, not trusted from arbitrary browser metadata. A user cannot self-register as `admin`, assign another user's role, or request an unknown role name. Organizer workspace ownership remains a separate protected workflow.

Admin and other privileged role grants remain under existing protected admin procedures. Stage 6 must establish the first administrator through a protected, auditable bootstrap, not through public signup. Provisioning retries must never overwrite user-edited profiles, reactivate roles that an admin disabled, or grant new privileged roles.

## Stage 3 identity-root treatment

The `private.app_users` table remains a minimal identity projection and FK parent, not a credential store. It will contain:
- `id uuid primary key`;
- trusted `email_verified_at`;
- trusted `phone_verified_at`;
- `verified_phone_identity_hash` only when a valid trusted phone-verification flow exists;
- creation/update timestamps.

For new Better Auth registrations, the Worker creates the D1 account and requests one server-only, transactional, idempotent Supabase provisioning operation. That operation inserts the same fresh UUID into `private.app_users`, creates the initial profile, assigns exactly one allowed basic role, and creates settings. It must not create a shadow row in `auth.users`.

No old Supabase Auth account is migrated. To keep existing application rows valid while the 69 FKs are rehomed, the reviewed FK planner may insert only distinct UUIDs that are still referenced by a child FK row, marked `identity_origin='legacy_reference'`. These tombstones contain no email, password, provider identity, verification state, session, or copied business role and cannot authenticate. Old Auth UUIDs without a live application FK reference are not imported. New Better Auth registrations get fresh UUIDs and `identity_origin='better_auth'`. Old accounts and linked application data are not used by the new login system and remain untouched; no cleanup operation is required.

## Email, referral, phone and organizer invariants

- Better Auth email verification is the only verification event for new accounts after cutover. A server-authenticated event updates `private.app_users.email_verified_at` and triggers pending referral qualification.
- Referral code resolution is server-side. Preserve the 24-hour qualification window, reward snapshot, row locking, ledger uniqueness and idempotent Edu Coin credit.
- Do not use browser-supplied referral owner UUIDs or trust profile metadata as proof of identity.
- Preserve the trusted verified-phone requirement for `create_organizer`. A profile WhatsApp field or client-supplied phone hash is not proof. No paid SMS/WhatsApp provider is approved. This workflow remains gated until a trustworthy Free-only approach or a reviewed compatibility plan exists.
- No password hash, secret, refresh token, access token, or session credential is placed in `private.app_users`.

## Acceptance tests

Before this direction is considered implemented, local synthetic tests must prove:
1. New registration creates a fresh UUID and uses it identically in D1, `private.app_users`, and JWT `sub`.
2. Provisioning failure/retry is transactional and idempotent.
3. Student, teacher and organizer map to the exact permitted roles.
4. Public registration cannot create or grant `admin` or arbitrary roles.
5. Existing `app_role` enum values and `user_roles` semantics remain present.
6. A provisioning retry never overwrites an edited profile or reactivates a disabled role.
7. Existing business authorization still reads `user_roles`; the JWT role remains `authenticated`.
8. Email/referral lifecycle and organizer phone-verification requirements remain intact.
9. No old credential or Supabase token is copied into D1 or exposed to the browser.

No production cleanup or legacy-account migration is authorized by this decision document. Stage 6 validates fresh-account provisioning and protected role assignment only; do not repeat the existing staging admin bootstrap. Stage 7 still owns the separately approved cutover.

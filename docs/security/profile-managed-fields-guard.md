# Profile managed-fields security audit

Date: 4 November 2026
Status: confirmed privilege-boundary gap; migration prepared for review, not applied to production.

## Finding

The production `profiles` table grants broad table privileges to both client roles. Its `profiles_self_update` RLS policy limits the row to `auth.uid() = id` in both `USING` and `WITH CHECK`, but PostgreSQL RLS policies are row-level, not column-level.

The current profile triggers protect `account_type`, `edu_coin`, and `total_xp`. They do not protect `status`, `verification_type`, `school_id`, `created_at`, or `last_name_change`. There are no column-level UPDATE restrictions for authenticated on these fields.

A user therefore cannot update another user's profile through the normal self-update policy, but can attempt to change backend-managed fields on their own row. The most important cases are:
- Set `verification_type` to an admin/verified badge value.
- Change `status` from a moderation state to `ACTIVE`.
- Change `school_id` to another school affiliation.
- Change `created_at` or `last_name_change` to alter server-managed timestamps.
- Change `full_name` and submit an arbitrary `last_name_change` timestamp to work around the UI-only seven-day cooldown.

This finding is excessive write authority over the caller's own profile, not proof that a caller can read or update another user's row.

## Prepared fix

The migration adds an internal `private`-schema `SECURITY DEFINER` trigger function and a normal `BEFORE UPDATE` trigger that:
- Reads the JWT role claim using `auth.jwt() ->> 'role'`, not the deprecated `auth.role()` helper or `current_user` (which changes inside a SECURITY DEFINER trigger).
- Blocks client roles `anon`/`authenticated` from changing `id`, `status`, `verification_type`, `school_id`, and `created_at`, except for an authenticated user whose admin role is confirmed by the database helper.
- Enforces the seven-day display-name cooldown using the stored `OLD.last_name_change` value.
- Sets `last_name_change` from `statement_timestamp()` when `full_name` changes, ignoring any client-supplied timestamp.
- Rejects attempts to change `last_name_change` independently.
- Revokes all direct table privileges from both client roles, then restores only `SELECT` for `anon` and `SELECT, UPDATE` for `authenticated`. Existing RLS policies continue to limit which profiles can be read and which row an authenticated user can update.

Existing protections for `account_type`, `edu_coin`, and `total_xp` remain unchanged. Ordinary authenticated edits such as bio, username, avatar, grade, institution, privacy settings, and badge showcase remain available via the self-update policy.

Trusted server-side operations and admin SECURITY DEFINER RPCs remain able to update managed fields because the trigger only applies client-role restrictions to `anon`/`authenticated`. Admin RPCs must continue to enforce their own authorization before writing. The migration does not grant clients direct insert or delete access.

## Isolated PostgreSQL integration coverage

The PR now runs the actual migration in a disposable PostgreSQL 17 service during CI. The test runner accepts only the fixed localhost test URL, and the SQL fixture is wrapped in a transaction that rolls back all roles, schemas, tables, functions, triggers, and grants at the end. It does not connect to Supabase production.

The fixture executes the trigger under `anon`, `authenticated`, the production-style active `user_roles` admin identity, and `service_role`; it verifies effective grants, no client `USAGE` on the private schema, public/private profile reads, owner-only updates, ordinary Edit Profile field compatibility (bio, institution, grade, birth date, subjects), managed-field rejection, cooldown enforcement, server-owned timestamps, non-admin and disabled-admin denial, and the actual production `admin_set_user_status` and `set_profile_verification` RPC bodies updating a different user's status and verification fields, including denial when the admin role is inactive. It uses a minimal fixture for the relevant Postgres/Supabase auth contract, not a complete copy of the production schema.

## Remaining verification before rollout

The isolated test covers the trigger and table/RLS boundary. Before production rollout, also validate the migration against the complete current schema and exercise the existing application RPCs that intentionally update managed profile fields. Required cases include:
1. Anonymous role retains public-profile SELECT access but has no direct INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER privileges.
2. Authenticated role retains SELECT and UPDATE only; RLS still restricts updates to the caller's own profile.
3. Direct PATCH of `status`, `verification_type`, `school_id`, `created_at`, or `id` must fail with `PROFILE_FIELD_MANAGED_BY_BACKEND`.
4. Direct PATCH of `last_name_change` without changing `full_name` must fail.
5. Changing `full_name` within seven days of `OLD.last_name_change` must fail with `PROFILE_NAME_CHANGE_COOLDOWN`.
6. Changing `full_name` after the cooldown must succeed and the database must set `last_name_change` to `statement_timestamp()`.
7. Updating allowed profile fields such as `bio` or `avatar_url` must still succeed.
8. Existing admin verification/status RPCs and trusted provisioning must still be able to change managed fields after their own authorization checks.
9. User A cannot read, update, or transfer ownership of User B's profile row.

No production schema or account data has been changed by this audit.

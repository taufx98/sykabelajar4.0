# Profile managed-fields security audit

Date: 4 November 2026
Status: confirmed privilege-boundary gap; migration prepared for review, not applied to production.

## Finding

The production profiles table grants UPDATE on all columns to the authenticated role. Its profiles_self_update RLS policy limits the row to auth.uid() = id, but PostgreSQL RLS policies are row-level, not column-level.

The current profile triggers protect account_type, edu_coin, and total_xp. They do not protect status, verification_type, school_id, created_at, or last_name_change. There are no column-level UPDATE restrictions for authenticated on these fields.

A user can therefore target their own row and attempt to change fields that the UI does not expose. The most important cases are:
- Set verification_type to an admin/verified badge value.
- Change status from a moderation state to ACTIVE.
- Change school_id to another school affiliation.
- Change created_at or last_name_change to alter server-managed timestamps.
- Change full_name and submit an arbitrary last_name_change timestamp to work around the UI-only seven-day cooldown.

This does not let a user edit another user's row; the issue is excessive write authority over their own profile.

## Prepared fix

The migration adds a normal BEFORE UPDATE trigger that:
- Blocks client roles anon/authenticated from changing id, status, verification_type, school_id, and created_at.
- Enforces the seven-day display-name cooldown using OLD.last_name_change at the database boundary.
- Sets last_name_change from statement_timestamp() when full_name changes, ignoring any client-supplied timestamp.
- Rejects attempts to change last_name_change independently.
- Runs after existing profile normalization triggers.
- Revokes direct INSERT/UPDATE/DELETE privileges from anon while preserving public reads and public RPC use.

Existing protections for account_type, edu_coin, and total_xp remain unchanged. Ordinary authenticated edits such as bio, username, avatar, education, privacy settings, and badge showcase remain permitted by the existing self-update policy.

Trusted server-side operations and admin SECURITY DEFINER RPCs remain able to update managed fields because the trigger only applies client-role restrictions to anon/authenticated. Admin RPCs must continue to enforce their own authorization before writing.

## Required integration tests before rollout

Run against an isolated Supabase environment using an authenticated test user:
1. Direct PATCH of status, verification_type, school_id, created_at, or id must fail with PROFILE_FIELD_MANAGED_BY_BACKEND.
2. Direct PATCH of last_name_change without changing full_name must fail.
3. Changing full_name within seven days of OLD.last_name_change must fail with PROFILE_NAME_CHANGE_COOLDOWN.
4. Changing full_name after the cooldown must succeed and the database must set last_name_change to statement_timestamp().
5. Updating allowed profile fields such as bio or avatar_url must still succeed.
6. Existing admin verification/status RPCs and trusted provisioning must still be able to change managed fields after their own authorization checks.

No production schema or account data has been changed by this audit.
